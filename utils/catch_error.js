const { EmbedBuilder } = require('discord.js');

const LOG_CHANNEL_ID = process.env.DISCORD_LOG_CHANNEL_ID;

/**
 * 발생한 에러를 지정된 디스코드 로그 채널로 전송합니다.
 * @param {import('discord.js').Client} client - 봇 클라이언트
 * @param {import('discord.js').Interaction} interaction - 에러가 발생한 상호작용
 * @param {Error} error - 발생한 에러 객체
 */
async function logErrorToDiscord(client, interaction, error) {
    if (!LOG_CHANNEL_ID) {
        console.warn('DISCORD_LOG_CHANNEL_ID가 설정되지 않아 에러 로깅을 건너뜁니다.');
        return;
    }

    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            console.error(`로그 채널(ID: ${LOG_CHANNEL_ID})을 찾을 수 없거나 텍스트 채널이 아닙니다.`);
            return;
        }

        const commandName = interaction.isCommand() ? interaction.commandName : 'Unknown Interaction';
        const user = interaction.user;

        // 에러 로그를 멋지게 임베드로 만들기
        const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000) // 빨간색
            .setTitle(`🚨 봇 에러 발생: /${commandName}`)
            .setDescription('```' + (error.stack || error.message).substring(0, 4000) + '```')
            .addFields(
                { name: '👤 사용자', value: `${user.tag} (${user.id})`, inline: true },
                { name: '📍 서버', value: `${interaction.guild.name}`, inline: true },
                { name: '⏰ 시간', value: new Date().toLocaleString('ko-KR'), inline: false }
            )
            .setTimestamp();

        await channel.send({ embeds: [errorEmbed] });

    } catch (loggingError) {
        console.error('!!! 디스코드 로그 전송 실패 !!!', loggingError);
        console.error('!!! 원본 에러 !!!', error);
    }
}

module.exports = { logErrorToDiscord };