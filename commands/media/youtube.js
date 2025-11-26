// 파일 위치: commands/youtube.js
const { SlashCommandBuilder } = require('discord.js');

/**
 * 헬퍼 함수: 유저와 봇의 상태를 확인하고 YoutubeManager를 반환
 */
async function getManager(interaction) {
    const { client, member } = interaction;

    // 1. 유저가 음성 채널에 있는지 확인
    const memberVoiceChannel = member.voice.channel;
    if (!memberVoiceChannel) {
        await interaction.reply({ content: '먼저 음성 채널에 들어와야 해!', ephemeral: true });
        return null;
    }

    // 2. 봇의 매니저 목록(client.voiceManagers)에서 해당 채널의 매니저를 찾음
    const manager = client.voiceManagers.get(memberVoiceChannel.id);

    // 3. 봇이 같은 채널에 있는지 확인
    if (!manager) {
        await interaction.reply({ content: '이 채널은 봇이 관리 중인 채널이 아니야!', ephemeral: true });
        return null;
    }
    
    // 4. 매니저가 YoutubeManager가 맞는지 확인
    if (manager.constructor.name !== 'YoutubeManager') {
        await interaction.reply({ content: '이 채널은 음악 재생용 채널이 아니야!', ephemeral: true });
        return null;
    }

    return manager;
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('youtube')
        .setDescription('유튜브 음악을 재생합니다.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('play')
                .setDescription('노래를 검색하거나 URL을 입력해 큐에 추가합니다.')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('검색할 노래 제목 또는 유튜브 URL')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('skip')
                .setDescription('지금 재생 중인 노래를 건너뜁니다.')) // ✨ 'skip' 서브커맨드
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('노래 재생을 멈추고 큐를 모두 비웁니다.')), // ✨ 'stop' 서브커맨드
                
    async execute(interaction) {
        // 1. YoutubeManager 가져오기 (공통 로직)
        const manager = await getManager(interaction);
        if (!manager) return; // 헬퍼 함수 내부에서 이미 응답(reply) 처리됨

        const subcommand = interaction.options.getSubcommand();

        try {
            // --- 2. 'play' 명령어 처리 ---
            if (subcommand === 'play') {
                const query = interaction.options.getString('query');
                await interaction.deferReply(); // 검색에 시간이 걸릴 수 있으므로
                
                // 헬퍼의 play 함수 호출
                const song = await manager.play(query);
                
                if (song) {
                    await interaction.editReply(`🎶 큐에 추가됐어!\n**${song.title}** (${song.duration})`);
                } else {
                    await interaction.editReply(`❌ \`${query}\` (을)를 찾을 수 없었어...`);
                }
            }

            // --- 3. 'skip' 명령어 처리 ---
            else if (subcommand === 'skip') {
                // ✨ 헬퍼의 skip 함수 호출
                const skipped = manager.skip(); // (true/false 반환)
                
                if (skipped) {
                    await interaction.reply({ content: '⏭️ 지금 재생 중인 노래를 스킵했어!' });
                } else {
                    await interaction.reply({ content: '❓ 스킵할 노래가 없는 것 같아.', ephemeral: true });
                }
            }

            // --- 4. 'stop' 명령어 처리 ---
            else if (subcommand === 'stop') {
                // ✨ 헬퍼의 stop 함수 호출
                manager.stop();
                await interaction.reply({ content: '⏹️ 재생을 멈추고 큐를 비웠어!' });
            }

        } catch (error) {
            console.error(`[commands/youtube.js] ${subcommand} 처리 중 오류:`, error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: '명령어 처리 중 오류가 발생했어... 😭', ephemeral: true });
            } else {
                await interaction.reply({ content: '명령어 처리 중 오류가 발생했어... 😭', ephemeral: true });
            }
        }
    },
};