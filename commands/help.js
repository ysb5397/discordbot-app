// commands/help.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('봇 도움말을 표시합니다.'),
    async execute(interaction) {
        const helpEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🤖 봇 도움말')
            .setDescription('사용 가능한 명령어 목록입니다.')
            .addFields(
                { name: '/chat [question] [file?]', value: 'AI와 대화합니다. (파일 첨부 가능)' },
                { name: '/deep_research [question]', value: 'AI에게 심층 리서치를 요청합니다.' },
                { name: '/create_event [...]', value: '서버 이벤트를 생성합니다.' },
                { name: '/edit_event [...]', value: '서버 이벤트를 수정합니다.' },
                { name: '/delete_event [name]', value: '서버 이벤트를 삭제합니다.' },
                { name: '/avatar', value: '자신의 아바타를 보여줍니다.' },
                { name: '/server', value: '서버 정보를 보여줍니다.' },
            );
        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    },
};