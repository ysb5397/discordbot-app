const { SlashCommandBuilder, InteractionContextType, PermissionsBitField } = require('discord.js');
const { WhiteList } = require('../utils/database.js');
const { content } = require('googleapis/build/src/apis/content/index.js');
const config = require('../config/manage_environments.js');

const OWNER_ID = config.discord.ownerId;
const BASE_MEMBER_ROLE_ID = config.discord.baseMemberRoleId;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('white_list')
        .setDescription('화리 설정을 변경 합니다. (관리자 전용)')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ])
        .addUserOption(option =>
            option.setName('member')
                .setDescription('화리에서 찾을 이용자의 ID를 넣습니다.')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('set_safety')
                .setDescription('안전한 이용자인지 설정합니다.(기본값: Black)')
                .setRequired(true)),

    async execute(interaction) {
        if (!BASE_MEMBER_ROLE_ID) {
            console.error('[white_list] .env에 BASE_MEMBER_ROLE_ID가 없습니다.');
            return interaction.reply({ content: '❌ 봇 설정에 기본 역할 ID가 지정되지 않았어요.', ephemeral: true });
        }

        if (interaction.user.id !== OWNER_ID) {
            console.error('[white_list] 관리자가 아닙니다.');
            return interaction.reply({ content: '❌ 관리자만 이 명령어를 사용할 수 있어요.', ephemeral: true });
        }
        
        const member = interaction.options.getMember('member');
        const setSafety = interaction.options.getBoolean('set_safety') || false;

        if (!member) {
             return interaction.reply({ content: '❌ 서버에서 해당 멤버를 찾을 수 없어요. 유저 ID를 다시 확인해 주세요.', ephemeral: true });
        }

        let role;
        try {
            role = await interaction.guild.roles.fetch(BASE_MEMBER_ROLE_ID);
            if (role == null) {
                throw new Error("역할 객체를 가져왔지만 null입니다.");
            }
        } catch (e) {
            console.error('[white_list] BASE_MEMBER_ROLE_ID로 역할을 찾는 데 실패:', e);
            return interaction.reply({ content: '❌ .env에 설정된 기본 역할 ID를 서버에서 찾을 수 없어요.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        
        try {
            const foundMember = await WhiteList.findOne({ memberId: member.id });
            if (foundMember == null) {
                await interaction.editReply({ content: '사용자를 찾지 못했어요... 화리를 새로 추가할게요!' });

                const newWhiteList = new WhiteList({
                    memberId: member.id,
                    isWhite: setSafety
                });

                await newWhiteList.save();
                
                await interaction.followUp({ content: `화리 추가가 완료됐어요! / 추가된 멤버 ID : ${member.id}`, ephemeral: true });
                return;
            }

            try {
                if (!setSafety) {
                    await member.roles.remove(role);
                } else {
                    await member.roles.add(role);
                }
            } catch (roleError) {
                if (roleError.code === 50013) {
                    console.error(`[white_list] 역할 관리 권한 오류:`, roleError);
                    await interaction.editReply(`❌ 역할 수정 실패! 봇의 역할이 '${role.name}' 역할보다 낮거나, 봇에게 '역할 관리' 권한이 없는 것 같아요.`);
                    return;
                }
                throw roleError;
            }
            
            await foundMember.updateOne({
                isWhite: setSafety
            });
            
            await interaction.editReply({ content: `화리 수정이 완료됐어요! / 수정된 멤버 ID : ${member.id}` });

        } catch (e) {
            console.error('whiteList 수정에 실패했어요....', e);
            if (!interaction.replied) {
                 await interaction.editReply({ content: '❌ 명령 실행 중 알 수 없는 오류가 발생했어요.', ephemeral: true });
            }
        }
    },
};