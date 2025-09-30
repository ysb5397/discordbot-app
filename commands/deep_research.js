// commands/deep_research.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

// .env 파일에서 환경 변수를 가져옵니다.

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
            
            // TODO -> 구글 검색 & Flowise를 거치지 않고 직접적으로 Gemini에게 분석 요청

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