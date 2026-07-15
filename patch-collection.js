const fs = require('fs');

const collectionPath = 'HandyMan_API_postman_collection.with_negatives.json';

// 1. Read the collection file
let collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

// 2. Ensure the root 'event' array exists
if (!collection.event) {
    collection.event = [];
}

// 3. Define the truncation script exactly as Newman needs it
const truncationScript = {
    "listen": "test",
    "script": {
        "type": "text/javascript",
        "exec": [
            "// Smart Truncation: Keep payloads small to prevent Newman JSON crashes",
            "const MAX_LENGTH = 1500;",
            "const rawBody = pm.response.text();",
            "if (rawBody && rawBody.length > MAX_LENGTH) {",
            "    const truncatedBody = rawBody.substring(0, MAX_LENGTH) + '\\n\\n... [PAYLOAD TRUNCATED BY QA SCRIPT TO SAVE MEMORY] ...';",
            "    pm.response.text = function() { return truncatedBody; };",
            "}"
        ]
    }
};

// 4. Inject it into the collection and save
collection.event.push(truncationScript);
fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2));

console.log("✅ Success! Truncation script injected into the collection."); 
