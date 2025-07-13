// commands/deep_research.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deep_research')
        .setDescription('AI에게 심층 리서치를 요청합니다 (계획 확인 단계 포함).')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('리서치할 주제 또는 질문')
                .setRequired(true)),

    async execute(interaction) {
        // --- 여기부터 ---
        if (interaction.deferred || interaction.replied) return;
        try { await interaction.deferReply(); } catch (e) { console.error("Defer failed for /deep_research:", e); return; }

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const botName = interaction.client.user.username;

        // --- AI 1 (분석가) 호출 ---
        let analystResponseText = '';
        try {
            console.log(`[/deep_research AI-1 Session: ${sessionId}] Sending to Flowise for initial analysis...`);
            const requestBodyAI1 = {
                question: userQuestion,
                overrideConfig: {
                    sessionId: sessionId,
                    vars: { bot_name: botName },
                }
            };
            const responseAI1 = await fetch(flowiseEndpoint, { /* ...기존 fetch 옵션... */ });
            // ... (기존 AI 1 호출 및 오류 처리 로직) ...
            const flowiseResponseAI1 = await responseAI1.json();
            analystResponseText = flowiseResponseAI1.text || "1차 분석 결과를 받지 못했습니다.";

        } catch (error) {
            console.error(`[/deep_research AI-1 Session: ${sessionId}] Error:`, error);
            await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 1차 분석 요청 중 오류가 발생했습니다.`);
            return;
        }

        // --- AI 2 (비평가/확장가) 호출 ---
        let criticResponseText = '';
        if (analystResponseText && analystResponseText !== "1차 분석 결과를 받지 못했습니다.") {
            try {
                await interaction.editReply({ content: `<@${interaction.user.id}> 1차 분석 완료. 추가 분석을 진행합니다...`, embeds: [] });
                
                console.log(`[/deep_research AI-2 Session: ${sessionId}] Sending to Flowise for critique/expansion...`);
                const requestBodyAI2 = {
                    question: `다음 분석 내용에 대해 비평하거나 확장된 의견을 제시해주세요: ${analystResponseText}`,
                    overrideConfig: { /* ...기존 overrideConfig 옵션... */ }
                };
                const responseAI2 = await fetch(flowiseEndpoint, { /* ...기존 fetch 옵션... */ });
                // ... (기존 AI 2 호출 및 오류 처리 로직) ...
                const flowiseResponseAI2 = await responseAI2.json();
                criticResponseText = flowiseResponseAI2.text || "2차 분석 결과를 받지 못했습니다.";

            } catch (error) {
                console.error(`[/deep_research AI-2 Session: ${sessionId}] Error:`, error);
                await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, AI 2차 분석 요청 중 오류가 발생했습니다.`, ephemeral: true });
                return;
            }
        }
        
        // --- 최종 결과 조합 및 파일 생성 ---
        const combinedForFile = `**[AI 1차 분석 결과]:**\n${analystResponseText}\n\n**[AI 2차 추가 의견]:**\n${criticResponseText || "(추가 의견 없음)"}`;
        let summaryText = "심층 분석 요약을 가져오지 못했습니다.";
        // ... (기존 요약 추출 로직) ...

        const summaryEmbed = new EmbedBuilder()
            .setTitle(`'${userQuestion}'에 대한 심층 분석 요약`)
            .setDescription(summaryText)
            .setColor(0x00BFFF)
            .setTimestamp()
            .setFooter({ text: '전체 분석 내용은 첨부된 파일을 확인해주세요.' });

        const fileName = `deep_research_${sessionId}_${Date.now()}.txt`;
        const filePath = path.join(__dirname, '..', fileName); // '..'를 추가하여 상위 폴더(루트)에 생성

        try {
            await fs.writeFile(filePath, combinedForFile);
            await interaction.followUp({
                content: `<@${interaction.user.id}> 심층 분석이 완료되었습니다.`,
                embeds: [summaryEmbed],
                files: [{ attachment: filePath, name: 'deep_research_full_report.txt' }]
            });
            await fs.unlink(filePath); // 전송 후 파일 삭제
        } catch (error) {
            console.error(`[/deep_research Session: ${sessionId}] Error sending final response:`, error);
            await interaction.followUp({ content: `<@${interaction.user.id}> 심층 분석 결과를 전송하는 중 오류가 발생했습니다.`, embeds: [summaryEmbed] });
        }
        // --- 여기까지 ---
    },
};