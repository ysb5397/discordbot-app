const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { exec } = require('child_process');
const util = require('util');


const execPromise = util.promisify(exec);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload_commands')
        .setDescription('Discord 슬래시 명령어를 수동으로 다시 등록합니다. (관리자 전용)')
        // 관리자 권한 설정
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const { stdout, stderr } = await execPromise('node deploy-commands.js');

            if (stderr) {
                console.warn('[/reload_commands] 명령어 등록 중 경고:', stderr);
                await interaction.editReply(`✅ 명령어 등록 성공 (일부 경고 발생):\n\`\`\`${stdout}\`\`\`\n**[경고]**\n\`\`\`${stderr}\`\`\``);
            } else {
                console.log('[/reload_commands] 명령어 등록 성공:', stdout);
                await interaction.editReply(`✅ 명령어를 성공적으로 다시 등록했습니다!\n\`\`\`${stdout}\`\`\``);
            }

        } catch (error) {
            console.error('[/reload_commands] 명령어 등록 실패:', error);
            await interaction.editReply(`❌ 명령어 등록에 실패했습니다:\n\`\`\`${error.stderr || error.message}\`\`\``);
        }
    },
};