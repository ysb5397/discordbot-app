const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
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

        // 1. 퀴즈 생성 중... (시간 걸림)
        await interaction.deferReply();

        try {
            const quizData = await generateQuiz(interaction.user.id, topic);

            // 2. 문제 출제 (Embed)
            const quizEmbed = new EmbedBuilder()
                .setTitle(`⚔️ [Lv.???] ${topic} 챌린지!`)
                .setDescription(`**난이도: ${quizData.difficulty}**\n\nQ. ${quizData.question}`)
                .setColor(0x0099FF)
                .setFooter({ text: '답변하려면 아래 버튼을 눌러!' });

            const answerBtn = new ActionRowBuilder().addComponents(
                new (require('discord.js').ButtonBuilder)()
                    .setCustomId('submit_answer')
                    .setLabel('답변 제출하기')
                    .setStyle(require('discord.js').ButtonStyle.Primary)
            );

            const msg = await interaction.editReply({
                content: `<@${interaction.user.id}>, 준비됐어?`,
                embeds: [quizEmbed],
                components: [answerBtn]
            });

            // 3. 버튼 클릭 대기 및 모달 처리 (Collector 사용)
            const collector = msg.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 60000 // 1분 제한
            });

            collector.on('collect', async i => {
                // 모달 띄우기
                const modal = new ModalBuilder()
                    .setCustomId('quiz_modal')
                    .setTitle('답변 작성');

                const input = new TextInputBuilder()
                    .setCustomId('answer_input')
                    .setLabel('여기에 답변을 적어줘 (서술형)')
                    .setStyle(TextInputStyle.Paragraph);

                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await i.showModal(modal);

                // 모달 제출 대기
                const submitted = await i.awaitModalSubmit({ time: 300000 }).catch(() => null);

                if (submitted) {
                    await submitted.deferUpdate();
                    const userAnswer = submitted.fields.getTextInputValue('answer_input');

                    // 4. 채점 진행
                    await interaction.editReply({ content: '🤔 채점 중... AI 면접관이 안경을 고쳐 쓰고 있어...', components: [] });

                    const result = await evaluateAnswer(interaction.user.id, quizData, userAnswer);

                    // 5. 결과 발표
                    const resultEmbed = new EmbedBuilder()
                        .setTitle(result.isCorrect ? '🎉 합격! (Pass)' : '💥 불합격 (Fail)')
                        .setDescription(`**점수:** ${result.score}점\n\n**📝 피드백:**\n${result.feedback}\n\n**💡 모범 답안:**\n${result.betterAnswer}`)
                        .setColor(result.isCorrect ? 0x00FA9A : 0xE74C3C);

                    // 프로필 갱신 후 레벨 표시
                    const profile = await DevProfile.findOne({ userId: interaction.user.id });
                    resultEmbed.addFields({ name: '📈 내 상태', value: `Lv.${profile.level} (XP: ${profile.xp})`, inline: true });

                    await interaction.followUp({ embeds: [resultEmbed] });
                }
            });

        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ 훈련 시스템 오류 발생! 다시 시도해줘.');
        }
    },
};