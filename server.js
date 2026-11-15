const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT) || 3000;
const dataDirectory = path.join(__dirname, "data");
const dataFile = path.join(dataDirectory, "entries.json");
const maxBodyBytes = 16 * 1024;

function readEntries() {
    try {
        return JSON.parse(fs.readFileSync(dataFile, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

function writeEntries(entries) {
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

function sendJson(response, statusCode, value) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        let tooLarge = false;
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            if (tooLarge) {
                return;
            }
            body += chunk;
            if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
                tooLarge = true;
            }
        });
        request.on("end", () => {
            if (tooLarge) {
                reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
            }
        });
        request.on("error", reject);
    });
}

function validateText(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 10000) {
        return null;
    }
    return value.trim();
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");

    try {
        if (url.pathname === "/api/entries" && request.method === "GET") {
            return sendJson(response, 200, readEntries());
        }

        if (url.pathname === "/api/entries" && request.method === "POST") {
            const body = await readJsonBody(request);
            const text = validateText(body && body.text);
            if (text === null) {
                return sendJson(response, 400, { error: "Entry text must be between 1 and 10000 characters." });
            }
            const entries = readEntries();
            const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), text };
            entries.push(entry);
            writeEntries(entries);
            return sendJson(response, 201, entry);
        }

        const entryMatch = url.pathname.match(/^\/api\/entries\/([a-z0-9]+)$/);
        if (entryMatch && (request.method === "PUT" || request.method === "DELETE")) {
            const entries = readEntries();
            const index = entries.findIndex((entry) => entry.id === entryMatch[1]);
            if (index === -1) {
                return sendJson(response, 404, { error: "Entry not found." });
            }
            if (request.method === "DELETE") {
                entries.splice(index, 1);
                writeEntries(entries);
                response.writeHead(204);
                return response.end();
            }
            const body = await readJsonBody(request);
            const text = validateText(body && body.text);
            if (text === null) {
                return sendJson(response, 400, { error: "Entry text must be between 1 and 10000 characters." });
            }
            entries[index].text = text;
            writeEntries(entries);
            return sendJson(response, 200, entries[index]);
        }

        if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/index.css")) {
            const fileName = url.pathname === "/index.css" ? "index.css" : "index.html";
            const contentType = fileName.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
            response.writeHead(200, { "Content-Type": contentType });
            return response.end(fs.readFileSync(path.join(__dirname, fileName)));
        }

        sendJson(response, 404, { error: "Not found." });
    } catch (error) {
        if (!response.headersSent && !response.destroyed) {
            sendJson(response, error.statusCode || 500, {
                error: error.statusCode ? error.message : "The server could not complete the request."
            });
        }
        if (!error.statusCode) {
            console.error(error);
        }
    }
});

server.listen(port, () => {
    console.log("Entry server running at http://localhost:" + port);
});
