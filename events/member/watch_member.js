const { Events } = require('discord.js');
const { logToDiscord } = require('../../utils/catch_log.js');
const { WhiteList } = require('../../utils/database.js');
const config = require('../../config/manage_environments.js');

const BASE_MEMBER_ROLE_ID = config.discord.baseMemberRoleId;

module.exports = {
    name: Events.GuildMemberAdd,
    
    /**
     * @param {import('discord.js').GuildMember} member - 새로 입장한 멤버 객체
     * @param {import('discord.js').Client} client - 봇 클라이언트
     */
    async execute(member, client) {
        
        if (client.amIActive === false) { 
            return;
        }

        if (member.user.bot) return;

        if (!BASE_MEMBER_ROLE_ID) {
            console.warn('[GuildMemberAdd] .env에 BASE_MEMBER_ROLE_ID가 설정되지 않아 역할 부여를 건너뜁니다.');
            return;
        }

        console.log(`[GuildMemberAdd] 새 멤버(${member.user.tag})가 서버에 참여했습니다. 역할 부여를 시도합니다...`);

        try {
            const role = await member.guild.roles.fetch(BASE_MEMBER_ROLE_ID);

            if (!role) {
                console.error(`[GuildMemberAdd] ID(${BASE_MEMBER_ROLE_ID})에 해당하는 역할을 찾을 수 없습니다.`);
                logToDiscord(client, 'ERROR', `새 멤버 역할 부여 실패: ID(${BASE_MEMBER_ROLE_ID}) 역할을 찾을 수 없음`, null, null, 'GuildMemberAdd');
                return;
            }

            const foundUser = WhiteList.findOne({ memberId: member.user.id });
            const isWhite = foundUser.isWhite || null;
    
            // 새로 오거나(null), 다시 들어온 사람이 안전한 경우(true) 모두 아래 if문 무시 가능
            if (!isWhite) {
                console.error(`[Warn] 멤버가 현재 블랙 상태입니다.`);
                logToDiscord(client, 'WARN', `${member.user.tag}에게 '${role.name}' 역할 부여 실패 / 현재 블랙 상태`, null, null, 'GuildMemberAdd');
                return;
            }

            // 이때, null인 사람을 새롭게 저장
            const newWhiteList = new WhiteList({
                userId: member.user.id,
                isWhite: true
            });
            await newWhiteList.save();

            await member.roles.add(role);

            console.log(`[GuildMemberAdd] ${member.user.tag}에게 '${role.name}' 역할을 성공적으로 부여했습니다.`);
            logToDiscord(client, 'INFO', `${member.user.tag}에게 '${role.name}' 역할 부여 완료`, null, null, 'GuildMemberAdd');

        } catch (error) {
            console.error(`[GuildMemberAdd] ${member.user.tag}에게 역할 부여 중 오류 발생:`, error);
            
            if (error.code === 50013) {
                logToDiscord(client, 'ERROR', `새 멤버 역할 부여 실패: 봇이 부여하려는 역할보다 상위 역할이 아니거나 '역할 관리' 권한이 없습니다.`, null, error, 'GuildMemberAdd');
            } else {
                logToDiscord(client, 'ERROR', `새 멤버 역할 부여 중 알 수 없는 오류 발생`, null, error, 'GuildMemberAdd');
            }
        }
    },
};