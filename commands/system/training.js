const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { generateQuiz, evaluateAnswer } = require('../../utils/ai/training_helper');
const { DevProfile } = require('../../utils/system/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('training')
        .setDescription('개발자 레벨업! 실무 역량 강화 퀴즈를 시작합니다.')
        .addStringOption(option =>
            option.setName('topic')
                .setDescription('훈련할 주제 (예: Database, React, CS, Algorithm)')
                .setRequired(true)),

    async execute(interaction) {
        const topic = interaction.options.getString('topic');
        const userId = interaction.user.id;

        // 1. 퀴즈 생성 중... (시간 걸림)
        await interaction.deferReply();

        try {
            const quizData = await generateQuiz(userId, topic);

            // 2. 문제 출제 (Embed)
            const quizEmbed = new EmbedBuilder()
                .setTitle(`⚔️ [${topic}] 챌린지!`)
                .setDescription(`**난이도: ${quizData.difficulty}**\n\nQ. ${quizData.question}`)
                .setColor(0x0099FF)
                .setFooter({ text: '준비되면 아래 버튼을 눌러서 답변을 제출해줘!' });

            const answerBtn = new ButtonBuilder()
                .setCustomId(`answer_btn_${interaction.id}`)
                .setLabel('답변 제출하기')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(answerBtn);

            const responseMsg = await interaction.editReply({
                content: `<@${userId}>, 면접관이 들어왔어. 긴장 풀어!`,
                embeds: [quizEmbed],
                components: [row]
            });

            // 3. 버튼 클릭 대기 및 모달 처리 (Collector 사용)
            const collector = responseMsg.createMessageComponentCollector({
                filter: i => i.user.id === userId && i.customId === `answer_btn_${interaction.id}`,
                time: 600000 // 10분 대기
            });

            collector.on('collect', async i => {
                // 모달 띄우기
                const modal = new ModalBuilder()
                    .setCustomId(`quiz_modal_${interaction.id}`)
                    .setTitle('답변 작성');

                const input = new TextInputBuilder()
                    .setCustomId('answer_input')
                    .setLabel('답변을 서술형으로 적어주세요.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await i.showModal(modal);

                // 모달 제출 대기
                const submitted = await i.awaitModalSubmit({ time: 600000 }).catch(() => null);

                if (submitted) {
                    await submitted.deferUpdate();

                    await interaction.editReply({
                        content: '🤔 채점 중... 면접관이 안경을 고쳐 쓰고 있어...',
                        embeds: [quizEmbed], // 문제는 계속 보여줌
                        components: [] // 버튼 제거
                    });

                    const userAnswer = submitted.fields.getTextInputValue('answer_input');

                    const result = await evaluateAnswer(userId, topic, quizData, userAnswer);

                    // 5. 결과 발표
                    const resultEmbed = new EmbedBuilder()
                        .setTitle(result.isCorrect ? '🎉 합격! (Pass)' : '💥 불합격 (Fail)')
                        .setDescription(`**점수:** ${result.score}점\n\n**📝 피드백:**\n${result.feedback}\n\n**💡 모범 답안:**\n${result.betterAnswer}`)
                        .setColor(result.isCorrect ? 0x00FA9A : 0xE74C3C);

                    // 프로필 갱신 후 레벨 표시
                    const profile = await DevProfile.findOne({ userId });
                    resultEmbed.addFields({ name: '📈 내 상태', value: `Lv.${profile.level} (XP: ${profile.xp})`, inline: true });

                    await interaction.followUp({ embeds: [resultEmbed] });

                    collector.stop();
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    interaction.editReply({ content: '⏰ 시간이 초과되어서 면접관이 퇴근했어.', components: [] });
                }
            });

        } catch (error) {
            console.error('[Train Command Error]', error);
            const errorMsg = '❌ 훈련 시스템 오류 발생! 다시 시도해줘.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorMsg, components: [] });
            } else {
                await interaction.reply({ content: errorMsg, ephemeral: true });
            }
        }
    },
};