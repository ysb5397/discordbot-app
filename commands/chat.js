const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const { Interaction } = require('../utils/database.js');
const { generateMongoFilter } = require('../utils/ai_helper.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화하거나, 저장된 기억을 검색합니다.')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 또는 검색할 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
    
    async execute(interaction) {
        await interaction.deferReply();

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const attachment = interaction.options.getAttachment('file');
        const botName = interaction.client.user.username;

        let searchResults = [];
        try {
            const filter = await generateMongoFilter(userQuestion, sessionId);
            searchResults = await Interaction.find(filter).sort({ timestamp: -1 }).limit(5);
        } catch (error) {
            console.error("Memory search failed:", error);
        }

        if (searchResults.length > 0) {
            const conversationalAiPromise = fetch(flowiseEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                body: JSON.stringify({ question: `The user asked to find something and I found it. The user's query was: "${userQuestion}". Now, provide a short, conversational comment about this.`, overrideConfig: { sessionId } })
            }).then(res => res.json());

            const flowiseResponse = await conversationalAiPromise;

            const embed = new EmbedBuilder()
                .setTitle('혹시 이 기억들을 찾고 있었어? 🤔')
                .setColor(0xFFD700);

            let description = ``;
            searchResults.forEach((doc, index) => {
                const content = (typeof doc.content === 'string' && doc.content.length > 100) ? doc.content.substring(0, 100) + '...' : (typeof doc.content === 'string' ? doc.content : `[${doc.type}] ${(doc.content.rem || '내용 없음')}`.substring(0, 100));
                description += `**${index + 1}.** [메시지 바로가기](https://discord.com/channels/${interaction.guildId}/${doc.channelId}/${doc.interactionId}) "${content}"\n*(${new Date(doc.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})*\n`;
            });
            embed.setDescription(description);

            if (flowiseResponse.text) {
                embed.addFields({ name: "AI의 추가 의견", value: flowiseResponse.text });
            }

            await interaction.editReply({ content: `<@${sessionId}>`, embeds: [embed] });

        } else {
            let history = [];
            try {
                const recentInteractions = await Interaction.find({ userId: sessionId, type: { $in: ['MESSAGE', 'MENTION'] } }).sort({ timestamp: -1 }).limit(10);
                history = recentInteractions.reverse().map(doc => {
                    const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                    const historyItem = { role: 'user', content: userMessage };
                    if (doc.type === 'MENTION' && doc.botResponse) {
                        return [historyItem, { role: 'assistant', content: doc.botResponse }];
                    }
                    return historyItem;
                }).flat();
            } catch (dbError) {
                console.error(`History retrieval failed:`, dbError);
            }

            const requestBody = {
                question: userQuestion,
                overrideConfig: { sessionId, vars: { bot_name: botName } },
                history: history
            };
                    
            if (attachment) {
                const response = await fetch(attachment.url);
                if (!response.ok) throw new Error(`Failed to fetch attachment: ${response.statusText}`);
                const imageBuffer = await response.buffer();
                const base64Data = imageBuffer.toString('base64');
                requestBody.uploads = [{ data: base64Data, type: 'file' }];
            }

            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`Flowise API Error: ${response.status}`, errorData);
                    await interaction.editReply(`<@${sessionId}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                    return;
                }

                const flowiseResponse = await response.json();
                const replyEmbed = new EmbedBuilder()
                    .setColor(0x00FA9A)
                    .setDescription(flowiseResponse.text || 'AI로부터 답변을 받지 못했습니다.')
                    .setTimestamp()
                    .setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });

                if (flowiseResponse.imageUrl) {
                    replyEmbed.setImage(flowiseResponse.imageUrl);
                }

                await interaction.editReply({ content: `<@${sessionId}>`, embeds: [replyEmbed] });

            } catch (error) {
                console.error(`Error processing Flowise request:`, error);
                await interaction.editReply(`<@${sessionId}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`);
            }
        }
    },
};