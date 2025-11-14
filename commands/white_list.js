const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { WhiteList } = require('../utils/database.js');

const OWNER_ID = process.env.MY_DISCORD_USER_ID;
const BASE_MEMBER_ROLE_ID = process.env.BASE_MEMBER_ROLE_ID;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('white_list')
        .setDescription('화리 설정을 변경 합니다. (관리자 전용)')
        .setContexts([
            InteractionContextType.Guild,          // 1. 서버
            InteractionContextType.BotDM,          // 2. 봇과의 1:1 DM
            InteractionContextType.PrivateChannel, // 3. 그룹 DM
        ])
        .addStringOption(option =>
            option.setName('member_id')
                .setDescription('화리에서 찾을 이용자의 ID를 넣습니다.')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('set_safety')
                .setDescription('안전한 이용자인지 설정합니다.(기본값: Black)')
                .setRequired(true)),

    async execute(interaction) {
        try {
            if (interaction.user.id !== OWNER_ID) {
                await interaction.reply({content: "이 명령어는 관리자만 사용가능합니다.", ephemeral: true});
                return;
            }

            const memberId = interaction.options.getString('member_id');
            const setSafety = interaction.options.getBoolean('set_safety') || false;
            const role = await interaction.guild.roles.fetch(BASE_MEMBER_ROLE_ID);

            await interaction.deferReply();
            
            const foundMember = await WhiteList.findOne({ memberId: memberId });

            if (foundMember == null) {
                await interaction.editReply('사용자를 찾지 못했어요... 화리를 새로 추가할게요!');

                const newWhiteList = new WhiteList({
                    memberId: memberId,
                    isWhite: setSafety
                });

                await newWhiteList.save();
                await interaction.editReply(`화리 추가가 완료됐어요! / 추가된 멤버 ID : ${memberId}`);
                return;
            }

            if (role == null) {
                throw Error("역할을 찾을 수 없어요.");
            }

            if (!setSafety) {
                await foundMember.roles.remove(role);
            }

            await foundMember.updateOne({
                isWhite: setSafety
            });
            await interaction.editReply(`화리 수정이 완료됐어요! / 수정된 멤버 ID : ${memberId}`);
        } catch(e) {
            console.error('whiteList 수정에 실패했어요....', e);
            throw e;
        }
    },
};