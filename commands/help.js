const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('봇 도움말을 표시합니다.'),
    async execute(interaction) {
        const { commands } = interaction.client;

        const filteredCommands = commands.filter(cmd => 
            cmd.data.default_member_permissions === undefined || 
            !interaction.member.permissions.has(cmd.data.default_member_permissions)
        );

        const commandFields = filteredCommands.map(command => {
            const commandName = `/${command.data.name}`;
            const description = command.data.description;
            
            if (command.data.options && command.data.options.some(opt => opt.type === 1)) {
                const subcommands = command.data.options
                    .filter(opt => opt.type === 1)
                    .map(sub => `\`${commandName} ${sub.name}\`: ${sub.description}`)
                    .join('\n');
                return { name: `🔹 ${commandName}`, value: `${description}\n${subcommands}` };
            }
            
            return { name: `🔹 /${command.data.name}`, value: command.data.description };
        });

        const helpEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🤖 봇 도움말')
            .setDescription('사용 가능한 모든 명령어 목록이야!')
            .addFields(commandFields)
            .setTimestamp()
            .setFooter({ text: `요청한 사람: ${interaction.user.tag}` });

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    },
};