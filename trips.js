//javascript
// Fleet data backend
// "zam" = Towards Zambia
// "drc" = Towards DRC
//
// Each upload replaces the selected table only.
// Storage: Firestore when FIREBASE_SERVICE_ACCOUNT is set,
// otherwise a local JSON file.
//
// CHANGED: Supports both /api/trips and /api/fleet.
// CHANGED: Normalizes old and new saved data formats.
// CHANGED: Always returns both tables with rows arrays.
// CHANGED: Keeps the other table unchanged when saving one table.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const emptyTable = () => ({
    rows: [],
    updated: ""
});

function normalizeTable(value) {
    // CHANGED: Support older data saved directly as an array.
    if (Array.isArray(value)) {
        return {
            rows: value,
            updated: ""
        };
    }

    // Current format: { rows: [], updated: "" }
    if (value && Array.isArray(value.rows)) {
        return {
            rows: value.rows,
            updated: value.updated || ""
        };
    }

    return emptyTable();
}

function normalizeData(value) {
    const data = value && typeof value === "object"
        ? value
        : {};

    return {
        zam: normalizeTable(
            data.zam ||
            data.towardsZambia ||
            data.towards_zambia
        ),
        drc: normalizeTable(
            data.drc ||
            data.towardsDRC ||
            data.towardsDrc ||
            data.towards_drc
        )
    };
}

function rowKey(row) {
    return String(row.h || "").trim().toUpperCase()
        + "|" +
        String(row.ld || "").trim();
}

function makeId(used) {
    let id;

    do {
        id = "TR-" +
            crypto.randomBytes(4).toString("hex").toUpperCase();
    } while (used.has(id));

    used.add(id);
    return id;
}

function cleanRow(input) {
    const b = input && typeof input === "object"
        ? input
        : {};

    const str = (value, max = 100) =>
        String(value == null ? "" : value)
            .trim()
            .slice(0, max);

    const row = {
        id: str(b.id, 30).replace(/[^\w-]/g, ""),
        h: str(b.h).replace(/\s+/g, " ").toUpperCase(),
        ld: str(b.ld),
        ll: str(b.ll),  
        od: str(b.od),
        ol: str(b.ol),
        cl: str(b.cl),
        cc: b.cc === "DRC"
            ? "DRC"
            : b.cc === "ZAM"
                ? "ZAM"
                : "",
        r: str(b.r, 200)
    };

    if (!row.h) {
        throw new Error("Horse is required");
    }

    if (row.ld && !DATE_RE.test(row.ld)) {
        throw new Error(
            "Loading date is invalid for " + row.h
        );
    }

    if (row.od && !DATE_RE.test(row.od)) {
        throw new Error(
            "Date offloaded is invalid for " + row.h
        );
    }

    if (row.od && !row.ld) {
        throw new Error(
            "Date offloaded needs a loading date for " + row.h
        );
    }

    if (row.od && row.od < row.ld) {
        throw new Error(
            "Date offloaded is before loading date for " + row.h
        );
    }

    return row;
}

function fileStore() {
    const directory =
        process.env.DATA_DIR ||
        path.join(__dirname, "data");

    const file = path.join(directory, "fleetdata.json");

    fs.mkdirSync(directory, { recursive: true });

    let saved = {};

    try {
        saved = JSON.parse(
            fs.readFileSync(file, "utf8")
        );
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw new Error(
                "Cannot read fleet data: " + error.message
            );
        }
    }

    function persist() {
        const tempFile = file + ".tmp";

        fs.writeFileSync(
            tempFile,
            JSON.stringify(saved, null, 2),
            "utf8"
        );

        fs.renameSync(tempFile, file);
    }

    return {
        async get() {
            // CHANGED: Return the normalized format the frontend expects.
            return normalizeData(saved);
        },

        async put(name, value) {
            // CHANGED: Update only the selected table.
            saved[name] = {
                rows: value.rows,
                updated: value.updated
            };

            persist();
        }
    };
}

function firestoreStore() {
    const db = require("firebase-admin").firestore();

    const ref = db
        .collection("fleet")
        .doc("current");

    return {
        async get() {
            const snapshot = await ref.get();

            const saved = snapshot.exists
                ? snapshot.data()
                : {};

            // CHANGED: Normalize Firestore data too.
            return normalizeData(saved);
        },

        async put(name, value) {
            // Update only this table; preserve the other table.
            await ref.set(
                {
                    [name]: {
                        rows: value.rows,
                        updated: value.updated
                    }
                },
                { merge: true }
            );
        }
    };
}

module.exports = function createTrips(options) {
    const { body, send } = options;

    const store = process.env.FIREBASE_SERVICE_ACCOUNT
        ? firestoreStore()
        : fileStore();

    return {
        async handle(req, res, pathname, method) {
            // CHANGED: Support both API base paths.
            const isTrips =
                pathname === "/api/trips" ||
                pathname.startsWith("/api/trips/");

            const isFleet =
                pathname === "/api/fleet" ||
                pathname.startsWith("/api/fleet/");

            if (!isTrips && !isFleet) {
                return send(res, 404, {
                    error: "Not found"
                });
            }

            // GET /api/trips or GET /api/fleet
            if (
                (pathname === "/api/trips" ||
                 pathname === "/api/fleet") &&
                method === "GET"
            ) {
                // CHANGED: Both tables always have rows arrays.
                return send(res, 200, await store.get());
            }

            // PUT /api/trips/zam, /api/trips/drc
            // Also supports /api/fleet/zam and /api/fleet/drc.
            const match = pathname.match(
                /^\/api\/(?:trips|fleet)\/(zam|drc)$/
            );

            if (match && method === "PUT") {
                const name = match[1];
                const payload = await body(req);

                if (
                    !payload ||
                    !Array.isArray(payload.rows)
                ) {
                    return send(res, 400, {
                        error: "Expected an object containing a rows array"
                    });
                }

                if (payload.rows.length > 2000) {
                    return send(res, 400, {
                        error: "Too many rows (maximum 2000)"
                    });
                }

                const incoming = payload.rows.map(cleanRow);
                const currentData = await store.get();

                const otherName = name === "zam"
                    ? "drc"
                    : "zam";

                const currentTable = currentData[name];
                const otherTable = currentData[otherName];

                // Prevent IDs from colliding with IDs in the other table.
                const used = new Set(
                    otherTable.rows
                        .map(row => row.id)
                        .filter(Boolean)
                );

                // Preserve existing IDs where possible.
                const previousIds = new Map();

                currentTable.rows.forEach(row => {
                    if (row.id) {
                        previousIds.set(
                            rowKey(row),
                            row.id
                        );
                    }
                });

                let created = 0;

                const rows = incoming.map(row => {
                    let id = row.id;

                    // Reuse a matching row's existing ID when appropriate.
                    if (!id || used.has(id)) {
                        id = previousIds.get(rowKey(row));

                        if (!id || used.has(id)) {
                            id = makeId(used);
                            created++;
                        }
                    }

                    used.add(id);

                    return {
                        ...row,
                        id
                    };
                });

                const result = {
                    rows,
                    updated: new Date().toISOString()
                };

                await store.put(name, result);

                return send(res, 200, {
                    ...result,
                    created
                });
            }

            return send(res, 404, {
                error: "Not found"
            });
        }
    };
};

