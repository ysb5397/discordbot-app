// 파일 위치: /utils/catch_error.js

const { EmbedBuilder } = require('discord.js');

const LOG_CHANNEL_ID = process.env.DISCORD_LOG_CHANNEL_ID;

/**
 * 발생한 에러를 지정된 디스코드 로그 채널로 전송합니다.
 * (interaction 객체가 없어도 작동하도록 업그레이드됨)
 * * @param {import('discord.js').Client} client - 봇 클라이언트
 * @param {import('discord.js').Interaction | null} interaction - (선택) 에러가 발생한 상호작용
 * @param {Error} error - 발생한 에러 객체
 * @param {string} origin - (선택) 에러 발생 위치 (예: 'uncaughtException')
 */
async function logErrorToDiscord(client, interaction, error, origin = 'Unknown') {
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

        const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000) // 빨간색
            .setTitle(`🚨 봇 에러 발생`)
            .setDescription('```' + (error.stack || error.message).substring(0, 4000) + '```')
            .addFields({ name: '⏰ 시간', value: new Date().toLocaleString('ko-KR'), inline: false })
            .setTimestamp();
        
        // [중요] interaction 객체가 있을 때만 유저/서버 정보를 추가
        if (interaction && interaction.isCommand()) {
            const commandName = interaction.commandName;
            const user = interaction.user;

            errorEmbed.setTitle(`🚨 봇 에러 발생: /${commandName}`);
            errorEmbed.addFields(
                { name: '👤 사용자', value: `${user.tag} (${user.id})`, inline: true },
                { name: '📍 서버', value: `${interaction.guild.name}`, inline: true }
            );
        } else {
            // interaction이 없으면(글로벌 에러), 에러 출처(origin)를 대신 표시
            errorEmbed.addFields(
                { name: '💥 출처', value: origin, inline: true }
            );
        }

        await channel.send({ embeds: [errorEmbed] });

    } catch (loggingError) {
        console.error('!!! 디스코드 로그 전송 실패 !!!', loggingError);
        console.error('!!! 원본 에러 !!!', error);
    }
}

module.exports = { logErrorToDiscord };