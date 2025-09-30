const fetch = require('node-fetch');

const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

async function generateMongoFilter(query, userId) {
    const prompt = `
    You are a MongoDB query filter generator. A user wants to find an entry in their interaction history. 
    Based on their request, create a JSON filter for a MongoDB 'find' operation. 
    
    - The user's ID is: "${userId}"
    - The user's natural language query is: "${query}"
    - The current date is: "${new Date().toISOString()}"
    
    - The schema has these fields: 'userId', 'type', 'content', 'timestamp', 'channelId'.
    - The 'type' can be 'MESSAGE', 'MENTION', or 'EARTHQUAKE'. Search all these types.
    - For text matching, use the '$regex' operator with '$options: "i"' for case-insensitivity.
    
    Respond ONLY with the raw JSON filter object. Do not include any other text or markdown.
    `;

    const response = await fetch(flowiseEndpoint, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json', 
            ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) 
        },
        body: JSON.stringify({ question: prompt, overrideConfig: { sessionId: `mongo-filter-gen-${userId}` } })
    });

    if (!response.ok) throw new Error(`AI filter generation failed: ${response.statusText}`);

    const aiResponse = await response.json();
    try {
        let jsonString = aiResponse.text.trim();
        if (jsonString.startsWith('```json')) {
            jsonString = jsonString.substring(7, jsonString.length - 3).trim();
        }
        const filter = JSON.parse(jsonString);
        filter.userId = userId; // Ensure security
        return filter;
    } catch (e) {
        console.error("Failed to parse AI-generated filter:", aiResponse.text);
        throw new Error("AI가 생성한 필터를 분석하는데 실패했습니다.");
    }
}

module.exports = { generateMongoFilter };
