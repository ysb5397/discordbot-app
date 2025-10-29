const { SlashCommandBuilder } = require('discord.js');
const { createBaseEmbed } = require('../utils/embed_builder.js');

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

        const helpEmbed = createBaseEmbed({
            title: '🤖 봇 도움말',
            description: '사용 가능한 모든 명령어 목록이야!',
            fields: commandFields,
            footerText: `요청한 사람: ${interaction.user.tag}`,
            color: 0x0099FF
        });

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    },
};