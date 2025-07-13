// commands/deep_research.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

// .env 파일에서 환경 변수를 가져옵니다.
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
        if (interaction.deferred || interaction.replied) return;
        try {
            await interaction.deferReply();
        } catch (e) {
            console.error("Defer failed for /deep_research:", e);
            return;
        }

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const botName = interaction.client.user.username;

        let analystResponseText = '';
        let criticResponseText = '';
        const filePath = path.join(__dirname, '..', `deep_research_${sessionId}_${Date.now()}.txt`); // 파일 경로 미리 정의

        try {
            // --- AI 1 (분석가) 호출 ---
            console.log(`[/deep_research AI-1 Session: ${sessionId}] Sending to Flowise for initial analysis...`);
            const requestBodyAI1 = {
                question: userQuestion,
                overrideConfig: {
                    sessionId: sessionId,
                    vars: { bot_name: botName },
                }
            };

            const responseAI1 = await fetch(flowiseEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {})
                },
                body: JSON.stringify(requestBodyAI1)
            });

            if (!responseAI1.ok) {
                // Flowise가 HTML 오류 페이지를 보낼 경우를 대비해 text()로 먼저 받습니다.
                const errorData = await responseAI1.text();
                console.error(`[/deep_research AI-1 Session: ${sessionId}] Flowise API Error: ${responseAI1.status}`, errorData);
                throw new Error(`Flowise AI 1차 분석 실패 (Code: ${responseAI1.status})`);
            }

            const flowiseResponseAI1 = await responseAI1.json();
            analystResponseText = flowiseResponseAI1.text || "1차 분석 결과를 받지 못했습니다.";

            // --- AI 2 (비평가/확장가) 호출 ---
            if (analystResponseText && analystResponseText !== "1차 분석 결과를 받지 못했습니다.") {
                await interaction.editReply({ content: `<@${interaction.user.id}> 1차 분석 완료. 추가 분석을 진행합니다...`, embeds: [] });
                
                console.log(`[/deep_research AI-2 Session: ${sessionId}] Sending to Flowise for critique/expansion...`);
                const requestBodyAI2 = {
                    question: `다음 분석 내용에 대해 비평하거나 확장된 의견을 제시해주세요: ${analystResponseText}`,
                    overrideConfig: {
                        sessionId: sessionId,
                        vars: { bot_name: botName, previous_analysis: analystResponseText },
                    }
                };

                const responseAI2 = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {})
                    },
                    body: JSON.stringify(requestBodyAI2)
                });
                
                if (!responseAI2.ok) {
                    const errorData = await responseAI2.text();
                    console.error(`[/deep_research AI-2 Session: ${sessionId}] Flowise API Error: ${responseAI2.status}`, errorData);
                    // 1차 결과라도 보여주기 위해 오류를 던지지 않고 넘어갈 수 있지만, 여기서는 실패로 간주합니다.
                    throw new Error(`Flowise AI 2차 분석 실패 (Code: ${responseAI2.status})`);
                }

                const flowiseResponseAI2 = await responseAI2.json();
                criticResponseText = flowiseResponseAI2.text || "2차 분석 결과를 받지 못했습니다.";
            }

            // --- 최종 결과 조합 및 파일 생성 ---
            const combinedForFile = `**[AI 1차 분석 결과]:**\n${analystResponseText}\n\n**[AI 2차 추가 의견]:**\n${criticResponseText || "(추가 의견 없음)"}`;
            
            // 간단한 요약 생성 (여기서는 1차 분석 결과의 첫 200자를 사용)
            let summaryText = analystResponseText.substring(0, 200) + (analystResponseText.length > 200 ? '...' : '');

            const summaryEmbed = new EmbedBuilder()
                .setTitle(`'${userQuestion}'에 대한 심층 분석 요약`)
                .setDescription(summaryText)
                .setColor(0x00BFFF)
                .setTimestamp()
                .setFooter({ text: '전체 분석 내용은 첨부된 파일을 확인해주세요.' });

            await fs.writeFile(filePath, combinedForFile);

            await interaction.editReply({ // AI-2 호출이 없었을 경우를 대비해 editReply 사용
                content: `<@${interaction.user.id}> 심층 분석이 완료되었습니다.`,
                embeds: [summaryEmbed],
                files: [{ attachment: filePath, name: 'deep_research_full_report.txt' }]
            });

        } catch (error) {
            console.error(`[/deep_research] An error occurred:`, error);
            // 오류가 발생했을 때 사용자에게 알려줍니다.
            if (!interaction.replied) {
                 await interaction.editReply({ content: `<@${interaction.user.id}> 죄송합니다. 심층 분석 중 오류가 발생했습니다.\n오류: ${error.message}`, embeds: [], files: [] });
            } else {
                 await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다. 심층 분석 중 오류가 발생했습니다.\n오류: ${error.message}`, ephemeral: true });
            }
        } finally {
            // 성공 여부와 관계없이 임시 파일을 삭제합니다.
            try {
                await fs.access(filePath); // 파일이 존재하는지 확인
                await fs.unlink(filePath);
            } catch {
                // 파일이 없거나 접근할 수 없으면 무시
            }
        }
    },
};