// commands/chat.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const { Interaction } = require('../utils/database.js'); // DB 모델 가져오기

// Flowise 관련 환경 변수
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

module.exports = {
    // 1. 명령어 설정
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화합니다.')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
    
    // 2. 명령어 실행 로직
    async execute(interaction) {
        if (interaction.deferred || interaction.replied) return;
        try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const attachment = interaction.options.getAttachment('file');
        const botName = interaction.client.user.username;

        // --- DB에서 대화 기록 검색 ---
        let history = [];
        try {
            const recentInteractions = await Interaction.find({
                userId: interaction.user.id,
                type: { $in: ['MESSAGE', 'MENTION'] } // 사용자의 메시지와 봇과의 대화만
            })
            .sort({ timestamp: -1 }) // 최신 순으로 정렬
            .limit(10); // 최근 10개 가져오기

            // AI에게 전달할 형식으로 변환 (오래된 메시지가 먼저 오도록 순서 뒤집기)
            history = recentInteractions.reverse().map(doc => {
                // doc.content가 문자열인지 확인 (Mongoose의 Mixed 타입은 객체일 수 있음)
                const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                const historyItem = { role: 'user', content: userMessage };
                
                if (doc.type === 'MENTION' && doc.botResponse) {
                    return [historyItem, { role: 'assistant', content: doc.botResponse }];
                }
                return historyItem;
            }).flat();

            console.log(`[/chat Session: ${sessionId}] Found ${history.length} items in conversation history.`);

        } catch (dbError) {
            console.error(`[/chat Session: ${sessionId}] Failed to retrieve conversation history:`, dbError);
            // DB 오류가 발생해도 AI 호출은 계속 진행
        }

        // --- Flowise 요청 본문 생성 ---
        const requestBody = {
            question: userQuestion,
            overrideConfig: { sessionId: sessionId, vars: { bot_name: botName } },
            history: history // 검색된 대화 기록 추가
        };
                
        if (attachment) {
            const response = await fetch(attachment.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            const imageBuffer = await response.buffer();
            const base64Data = imageBuffer.toString('base64');
            requestBody.uploads = [{ data: base64Data, type: 'file' }];
        }

        console.log(`[/chat Session: ${sessionId}] Sending to Flowise...`);

        // --- Flowise API 호출 ---
        try {
            const response = await fetch(flowiseEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[/chat Session: ${sessionId}] Flowise API Error: ${response.status}`, errorData);
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
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

            await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: [replyEmbed] });

        } catch (error) {
            console.error(`[/chat Session: ${sessionId}] Error processing Flowise request:`, error);
            try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
        }
    },
};
