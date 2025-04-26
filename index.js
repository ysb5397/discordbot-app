// discord.js v14 이상 필요
// 필요한 모든 모듈을 한 번에 불러옵니다.
const {
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder,
    InteractionType, Events, ChannelType, GuildScheduledEventPrivacyLevel,
    GuildScheduledEventEntityType, PermissionsBitField
} = require('discord.js');
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config(); // .env 파일 로드

// v14 Intents 사용
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents // 이벤트 관련 기능에 필요할 수 있음
    ]
});

// --- 환경 변수 확인 및 로드 ---
const discordToken = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

// 필수 환경 변수 확인
if (!discordToken || !clientId || !guildId || !flowiseEndpoint) {
    console.error("필수 환경 변수(DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, FLOWISE_ENDPOINT) 중 하나 이상이 설정되지 않았습니다.");
    process.exit(1);
}
if (!flowiseApiKey) {
    console.warn("환경 변수 'FLOWISE_API_KEY'가 설정되지 않았습니다. API 키가 필요 없는 Flowise 설정인 경우 무시하세요.");
}

// --- 봇 이름 변수 ---
let botName = "AI Assistant"; // 기본 이름 (봇이 로그인하기 전까지 사용될 값)

// --- 유틸리티 함수 ---
// 시간 문자열 파싱 함수 (KST -> UTC Date 객체)
function parseKSTDateTime(dateTimeString) {
    const dateParts = dateTimeString.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})/);
    if (!dateParts) throw new Error("Invalid date format. Use 'YYYY-MM-DD HH:MM'");

    const year = parseInt(dateParts[1]);
    const month = parseInt(dateParts[2]) - 1; // JavaScript month is 0-indexed
    const day = parseInt(dateParts[3]);
    const hourKST = parseInt(dateParts[4]);
    const minute = parseInt(dateParts[5]);

    // 입력된 KST 시간을 기준으로 UTC 타임스탬프 계산
    const utcTimestamp = Date.UTC(year, month, day, hourKST - 9, minute);
    const dateObject = new Date(utcTimestamp);

    if (isNaN(dateObject.getTime())) throw new Error('Invalid date calculation');
    return dateObject;
}


// --- 슬래시 명령어 정의 (모든 명령어 통합) ---
const commands = [
    // /chat 명령어
    new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화합니다.')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
    // /help 명령어
    new SlashCommandBuilder().setName('help').setDescription('봇 도움말을 표시합니다.'),
    // /avatar 명령어
    new SlashCommandBuilder().setName('avatar').setDescription('당신의 아바타 URL을 보여줍니다.'),
    // /server 명령어
    new SlashCommandBuilder().setName('server').setDescription('서버 정보를 보여줍니다.'),
    // /call 명령어
    new SlashCommandBuilder().setName('call').setDescription('콜백 메시지를 보냅니다.'),
    // /create_event 명령어
    new SlashCommandBuilder()
        .setName('create_event')
        .setDescription('서버 이벤트를 생성합니다.')
        .addStringOption(option => option.setName('name').setDescription('이벤트 이름').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('이벤트 설명').setRequired(true))
        .addStringOption(option => option.setName('start_time').setDescription("시작 시간 (예: '2025-05-10 20:00') - KST").setRequired(true))
        .addChannelOption(option => option.setName('channel').setDescription('이벤트 채널 (음성/스테이지/텍스트)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(true))
        .addStringOption(option => option.setName('end_time').setDescription("종료 시간 (예: '2025-05-10 22:00') - 텍스트 채널 시 필수").setRequired(false)),
    // /edit_event 명령어
    new SlashCommandBuilder()
        .setName('edit_event')
        .setDescription('기존 서버 이벤트를 수정합니다.')
        .addStringOption(option => option.setName('current_name').setDescription('수정할 이벤트의 현재 이름').setRequired(true)) // 이름으로 이벤트 식별
        .addStringOption(option => option.setName('new_name').setDescription('새 이벤트 이름 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_description').setDescription('새 이벤트 설명 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_start_time').setDescription("새 시작 시간 (예: '2025-05-11 21:00') - KST").setRequired(false))
        .addChannelOption(option => option.setName('new_channel').setDescription('새 이벤트 채널 (선택 사항)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(false))
        .addStringOption(option => option.setName('new_end_time').setDescription("새 종료 시간 (예: '2025-05-11 23:00')").setRequired(false)),
    // /delete_event 명령어
    new SlashCommandBuilder()
        .setName('delete_event')
        .setDescription('서버 이벤트를 삭제합니다.')
        .addStringOption(option => option.setName('name').setDescription('삭제할 이벤트의 이름').setRequired(true)) // 이름으로 이벤트 식별

].map(command => command.toJSON());

// --- 명령어 등록 로직 ---
const rest = new REST({ version: '10' }).setToken(discordToken);

(async () => {
    try {
        console.log('(/) 슬래시 명령어 등록 시작...');
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );
        console.log('(/) 슬래시 명령어가 성공적으로 등록되었습니다.');
    } catch (error) {
        console.error('(/) 슬래시 명령어 등록 중 오류 발생:', error);
    }
})();


// --- 유틸리티 함수 ---
const sleep = (ms) => {
    return new Promise((r) => setTimeout(r, ms));
}

// --- Discord 봇 로그인 ---
const discordLogin = async () => {
    try {
        await client.login(discordToken);
    } catch (error) {
        console.error("Discord 로그인 실패:", error.message);
        if (error.code === 'TOKEN_INVALID') {
            console.error("-> 제공된 토큰이 유효하지 않습니다.");
        }
        await sleep(5000);
        process.exit(1);
    }
}

discordLogin();

// --- 이벤트 핸들러 ---
client.on(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}.`);
    // *** 봇 이름 변수 업데이트 ***
    botName = client.user.username; // 실제 봇 사용자 이름으로 업데이트
    console.log(`Bot name set to: ${botName}`); // 로그 추가 (확인용)
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

// --- 슬래시 명령어 처리 핸들러 ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    console.log(`Processing interaction: /${commandName} by ${interaction.user.tag}`);

    // --- /chat 명령어 처리 ---
    if (commandName === 'chat') {
        // ... (deferReply, userQuestion, sessionId, attachment 등 가져오는 코드는 동일) ...
        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const attachment = interaction.options.getAttachment('file');

        // Flowise API 요청 본문 구성
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId,
                // *** vars 객체 추가하여 봇 이름 전달 ***
                vars: {
                    bot_name: botName // 여기서 정의된 botName 변수 전달
                }
            }
        };
        // 파일 첨부 시 uploads 필드 추가
        if (attachment) {
            requestBody.uploads = [{
                type: 'url',
                name: attachment.name,
                mime: attachment.contentType || 'application/octet-stream',
                data: attachment.url
            }];
        }

        console.log(`[Session: ${sessionId}] Sending to Flowise:`, JSON.stringify(requestBody, null, 2)); // 수정된 requestBody 로그 확인

        try {
            // ... (Flowise API 호출 및 응답 처리 로직은 동일) ...
        } catch (error) {
            // ... (오류 처리 로직은 동일) ...
        }
    }
    // --- /create_event 명령어 처리 ---
    else if (commandName === 'create_event') {
        // ... (이전 /create_event 처리 로직과 동일) ...
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) { return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true }); }
        if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) { return interaction.reply({ content: '봇이 이벤트를 생성할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true }); }
        try {
            await interaction.deferReply({ ephemeral: true });
            const eventName = interaction.options.getString('name');
            const eventDescription = interaction.options.getString('description');
            const startTimeString = interaction.options.getString('start_time');
            const eventChannel = interaction.options.getChannel('channel');
            const endTimeString = interaction.options.getString('end_time');
            let scheduledStartTime;
            try { scheduledStartTime = parseKSTDateTime(startTimeString); if (scheduledStartTime < new Date()) { return interaction.editReply('오류: 이벤트 시작 시간은 현재 시간 이후여야 합니다.'); } console.log(`[Schedule Create] Parsed start time: ${startTimeString} KST -> ${scheduledStartTime.toISOString()} UTC`); }
            catch (e) { console.error("Start Date parsing error:", e); return interaction.editReply(`오류: 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`); }
            let scheduledEndTime = null;
            if (endTimeString) { try { scheduledEndTime = parseKSTDateTime(endTimeString); if (scheduledEndTime <= scheduledStartTime) { return interaction.editReply('오류: 이벤트 종료 시간은 시작 시간 이후여야 합니다.'); } console.log(`[Schedule Create] Parsed end time: ${endTimeString} KST -> ${scheduledEndTime.toISOString()} UTC`); } catch (e) { console.error("End Date parsing error:", e); return interaction.editReply(`오류: 종료 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`); } }
            const eventOptions = { name: eventName, description: eventDescription, scheduledStartTime: scheduledStartTime, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, entityType: null };
            if (eventChannel.type === ChannelType.GuildStageVoice) { eventOptions.entityType = GuildScheduledEventEntityType.StageInstance; eventOptions.channel = eventChannel.id; if (scheduledEndTime) eventOptions.scheduledEndTime = scheduledEndTime; }
            else if (eventChannel.type === ChannelType.GuildVoice) { eventOptions.entityType = GuildScheduledEventEntityType.Voice; eventOptions.channel = eventChannel.id; if (scheduledEndTime) eventOptions.scheduledEndTime = scheduledEndTime; }
            else if (eventChannel.type === ChannelType.GuildText) { eventOptions.entityType = GuildScheduledEventEntityType.External; eventOptions.entityMetadata = { location: `#${eventChannel.name} 채널에서 진행` }; if (!scheduledEndTime) { return interaction.editReply('오류: 텍스트 채널을 이벤트 장소로 지정할 경우, 반드시 종료 시간(`end_time` 옵션)을 입력해야 합니다.'); } eventOptions.scheduledEndTime = scheduledEndTime; }
            else { return interaction.editReply('오류: 지원하지 않는 채널 타입입니다.'); }
            const createdEvent = await interaction.guild.scheduledEvents.create(eventOptions);
            console.log(`Event created: ${createdEvent.name} (ID: ${createdEvent.id})`);
            await interaction.editReply(`✅ 이벤트 "${createdEvent.name}"이(가) 성공적으로 생성되었습니다! (시작: ${startTimeString} KST${endTimeString ? `, 종료: ${endTimeString} KST` : ''})`);
        } catch (error) { console.error('Error creating scheduled event:', error); if (error.code === 50035 && error.message.includes('scheduled_end_time')) { await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 텍스트 채널을 선택한 경우 종료 시간이 필요합니다.'); } else { await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 입력값, 봇 권한, 채널 설정을 확인해주세요.'); } }
    }
    // --- /edit_event 명령어 처리 ---
    else if (commandName === 'edit_event') {
        // 권한 확인
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
             return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
        }
        if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
            return interaction.reply({ content: '봇이 이벤트를 수정할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const currentName = interaction.options.getString('current_name');
            const newName = interaction.options.getString('new_name');
            const newDescription = interaction.options.getString('new_description');
            const newStartTimeString = interaction.options.getString('new_start_time');
            const newChannel = interaction.options.getChannel('new_channel');
            const newEndTimeString = interaction.options.getString('new_end_time');

            // 이름으로 이벤트 찾기 (중복 가능성 있음)
            const events = await interaction.guild.scheduledEvents.fetch();
            const targetEvents = events.filter(event => event.name === currentName);

            if (targetEvents.size === 0) {
                return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트를 찾을 수 없습니다.`);
            }
            if (targetEvents.size > 1) {
                return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트가 여러 개 있습니다. 더 구체적인 이름이나 ID로 수정해주세요. (ID 기반 수정은 아직 지원되지 않습니다.)`);
            }

            const eventToEdit = targetEvents.first(); // 첫 번째 (유일한) 이벤트 선택
            const editOptions = {}; // 수정할 옵션만 담을 객체

            // 각 옵션이 입력되었는지 확인하고 editOptions에 추가
            if (newName) editOptions.name = newName;
            if (newDescription) editOptions.description = newDescription;

            // 시작 시간 수정 처리
            if (newStartTimeString) {
                try {
                    editOptions.scheduledStartTime = parseKSTDateTime(newStartTimeString);
                    if (editOptions.scheduledStartTime < new Date()) {
                        return interaction.editReply('오류: 새 시작 시간은 현재 시간 이후여야 합니다.');
                    }
                    console.log(`[Schedule Edit] Parsed new start time: ${newStartTimeString} KST -> ${editOptions.scheduledStartTime.toISOString()} UTC`);
                } catch (e) {
                    console.error("New Start Date parsing error:", e);
                    return interaction.editReply(`오류: 새 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                }
            }

            // 종료 시간 수정 처리
            let newScheduledEndTime = null;
            if (newEndTimeString) {
                try {
                    newScheduledEndTime = parseKSTDateTime(newEndTimeString);
                    const startTimeToCheck = editOptions.scheduledStartTime || eventToEdit.scheduledStartAt; // 새 시작 시간이 있으면 그것 기준, 없으면 기존 시작 시간 기준
                    if (newScheduledEndTime <= startTimeToCheck) {
                        return interaction.editReply('오류: 새 종료 시간은 시작 시간 이후여야 합니다.');
                    }
                    editOptions.scheduledEndTime = newScheduledEndTime;
                    console.log(`[Schedule Edit] Parsed new end time: ${newEndTimeString} KST -> ${editOptions.scheduledEndTime.toISOString()} UTC`);
                } catch (e) {
                    console.error("New End Date parsing error:", e);
                    return interaction.editReply(`오류: 새 종료 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                }
            } else if (eventToEdit.entityType === GuildScheduledEventEntityType.External && !eventToEdit.scheduledEndAt) {
                // 외부 이벤트인데 종료 시간이 없는 상태에서 종료 시간 수정 없이 다른 것만 바꾸려 할 때 방지
                // (이 경우는 API 레벨에서 막힐 수도 있음)
                 // console.warn("External event needs an end time, but none provided for edit.");
                 // 필요시 오류 처리 추가
            }


            // 채널/위치 수정 처리
            if (newChannel) {
                if (newChannel.type === ChannelType.GuildStageVoice) {
                    editOptions.entityType = GuildScheduledEventEntityType.StageInstance;
                    editOptions.channel = newChannel.id;
                    editOptions.entityMetadata = null; // 외부 위치 정보 제거
                } else if (newChannel.type === ChannelType.GuildVoice) {
                    editOptions.entityType = GuildScheduledEventEntityType.Voice;
                    editOptions.channel = newChannel.id;
                    editOptions.entityMetadata = null; // 외부 위치 정보 제거
                } else if (newChannel.type === ChannelType.GuildText) {
                    editOptions.entityType = GuildScheduledEventEntityType.External;
                    editOptions.entityMetadata = { location: `#${newChannel.name} 채널에서 진행` };
                    editOptions.channel = null; // 채널 정보 제거
                    // 외부 이벤트로 변경 시 종료 시간 확인
                    const endTimeToCheck = editOptions.scheduledEndTime || eventToEdit.scheduledEndAt;
                    if (!endTimeToCheck) {
                        return interaction.editReply('오류: 이벤트 장소를 텍스트 채널(외부)로 변경하려면 종료 시간이 필요합니다. `new_end_time` 옵션도 함께 입력해주세요.');
                    }
                    // 종료 시간이 이미 설정되어 있다면 editOptions에 포함 (위에서 처리됨)
                } else {
                    return interaction.editReply('오류: 지원하지 않는 채널 타입입니다.');
                }
            } else if (eventToEdit.entityType === GuildScheduledEventEntityType.External && !editOptions.scheduledEndTime && !eventToEdit.scheduledEndAt) {
                 // 외부 이벤트인데 종료 시간이 없는 상태에서 채널 변경 없이 종료 시간도 수정 안하면 오류 방지
                 // (API 레벨에서 막힐 수도 있음)
                 // console.warn("External event needs an end time, but channel and end time are not being updated.");
                 // 필요시 오류 처리 추가
            }


            // 수정할 내용이 있는지 확인
            if (Object.keys(editOptions).length === 0) {
                return interaction.editReply('수정할 내용을 하나 이상 입력해주세요.');
            }

            // 이벤트 수정 시도
            const updatedEvent = await eventToEdit.edit(editOptions);

            console.log(`Event updated: ${updatedEvent.name} (ID: ${updatedEvent.id})`);
            await interaction.editReply(`✅ 이벤트 "${currentName}"이(가) 성공적으로 수정되었습니다! (새 이름: ${updatedEvent.name})`);

        } catch (error) {
            console.error('Error editing scheduled event:', error);
             // Discord API 오류 코드 확인 (예: 권한 부족, 잘못된 시간 등)
            if (error.code === 50035) { // Invalid Form Body
                 if (error.message.includes('scheduled_end_time')) {
                     await interaction.editReply('❌ 이벤트 수정 중 오류: 외부 이벤트에는 종료 시간이 필요합니다.');
                 } else if (error.message.includes('scheduled_start_time')) {
                     await interaction.editReply('❌ 이벤트 수정 중 오류: 시작 시간은 현재 시간 이후여야 합니다.');
                 } else {
                    await interaction.editReply('❌ 이벤트 수정 중 오류가 발생했습니다. 입력값을 확인해주세요.');
                 }
            } else if (error.code === 50013) { // Missing Permissions
                 await interaction.editReply('❌ 이벤트 수정 중 오류: 봇이 이벤트를 수정할 권한이 없습니다.');
            }
            else {
                await interaction.editReply('❌ 이벤트를 수정하는 중 오류가 발생했습니다. 입력값이나 봇 권한을 확인해주세요.');
            }
        }
    }
    // --- /delete_event 명령어 처리 ---
    else if (commandName === 'delete_event') {
        // 권한 확인
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
             return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
        }
        if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
            return interaction.reply({ content: '봇이 이벤트를 삭제할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const eventName = interaction.options.getString('name');

            // 이름으로 이벤트 찾기
            const events = await interaction.guild.scheduledEvents.fetch();
            const targetEvents = events.filter(event => event.name === eventName);

            if (targetEvents.size === 0) {
                return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트를 찾을 수 없습니다.`);
            }
            if (targetEvents.size > 1) {
                // 여러 개일 경우, ID 목록을 보여주고 선택하게 하는 것이 좋지만 여기서는 오류 처리
                 const eventList = targetEvents.map((event, id) => ` - ${event.name} (ID: ${id})`).join('\n');
                return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트가 여러 개 발견되었습니다. 삭제할 이벤트의 ID를 사용하여 다시 시도해주세요.\n발견된 이벤트:\n${eventList}\n(ID 기반 삭제는 아직 지원되지 않습니다.)`);
            }

            const eventToDelete = targetEvents.first();

            // 이벤트 삭제 시도
            await interaction.guild.scheduledEvents.delete(eventToDelete.id);

            console.log(`Event deleted: ${eventToDelete.name} (ID: ${eventToDelete.id})`);
            await interaction.editReply(`✅ 이벤트 "${eventName}"이(가) 성공적으로 삭제되었습니다!`);

        } catch (error) {
            console.error('Error deleting scheduled event:', error);
            if (error.code === 50013) { // Missing Permissions
                 await interaction.editReply('❌ 이벤트 삭제 중 오류: 봇이 이벤트를 삭제할 권한이 없습니다.');
            } else if (error.code === 10062) { // Unknown Interaction or Event
                 await interaction.editReply('❌ 이벤트 삭제 중 오류: 해당 이벤트를 찾을 수 없거나 이미 삭제되었습니다.');
            }
            else {
                await interaction.editReply('❌ 이벤트를 삭제하는 중 오류가 발생했습니다.');
            }
        }
    }
    // --- 다른 슬래시 명령어 처리 ---
    else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("도움말")
            .setColor(0xFFD700)
            // 명령어 설명 업데이트
            .setDescription('명령어: /chat [질문] [file:첨부파일], /help, /avatar, /server, /call, /create_event [옵션들], /edit_event [옵션들], /delete_event [이름]');
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    else if (commandName === 'avatar') { /* ... */ await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true }); }
    else if (commandName === 'server') { /* ... */ await interaction.reply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`); }
    else if (commandName === 'call') { /* ... */ await interaction.reply(`<@${interaction.user.id}> !callback`); }
});

// --- 기존 메시지 기반 명령어 처리 (주석 처리 또는 제거) ---
/*
client.on('messageCreate', async msg => {
    // ...
});
*/
// ```

// **주요 변경점:**

// 1.  **명령어 정의 추가:**
//     * `/edit_event`: `current_name`(필수)과 수정할 필드들(`new_name`, `new_description` 등)을 선택적 옵션으로 추가했습니다.
//     * `/delete_event`: `name`(필수) 옵션을 추가했습니다.
// 2.  **`/edit_event` 로직:**
//     * 사용자와 봇의 '이벤트 관리' 권한을 확인합니다.
//     * `interaction.options.getString('current_name')`으로 수정할 이벤트 이름을 받습니다.
//     * `interaction.guild.scheduledEvents.fetch()`로 서버의 모든 이벤트를 가져와 이름으로 필터링합니다.
//     * 일치하는 이벤트가 없거나 여러 개면 오류 메시지를 보냅니다.
//     * 일치하는 이벤트가 하나면 해당 이벤트를 가져옵니다 (`eventToEdit`).
//     * 사용자가 입력한 `new_...` 옵션 값들만 `editOptions` 객체에 담습니다.
//     * 시간(`new_start_time`, `new_end_time`)이나 채널(`new_channel`)이 변경되면, 이전 `/create_event`와 유사하게 파싱하고 유효성을 검사하며, `entityType` 등을 적절히 설정합니다. (특히 텍스트 채널로 변경 시 종료 시간 필수 확인)
//     * 수정할 내용이 하나라도 있으면 `eventToEdit.edit(editOptions)`를 호출하여 이벤트를 수정합니다.
//     * 성공 또는 실패 메시지를 보냅니다.
// 3.  **`/delete_event` 로직:**
//     * 사용자와 봇의 '이벤트 관리' 권한을 확인합니다.
//     * `interaction.options.getString('name')`으로 삭제할 이벤트 이름을 받습니다.
//     * 서버의 모든 이벤트를 가져와 이름으로 필터링합니다.
//     * 일치하는 이벤트가 없거나 여러 개면 오류 메시지를 보냅니다.
//     * 일치하는 이벤트가 하나면 해당 이벤트 ID를 사용하여 `interaction.guild.scheduledEvents.delete(eventId)`를 호출하여 삭제합니다.
//     * 성공 또는 실패 메시지를 보냅니다.
// 4.  **`/help` 업데이트:** 새로 추가된 명령어 설명을 포함하도록 수정했습니다.
// 5.  **시간 파싱 함수:** 시간 문자열을 파싱하는 로직을 `parseKSTDateTime` 함수로 분리하여 재사용했습니다.

// 이제 이 코드를 배포하시면 `/edit_event`와 `/delete_event` 명령어를 사용하여 서버 이벤트를 관리할 수 있습니다. **주의:** 이름으로 이벤트를 식별하는 방식은 이름이 중복될 경우 문제가 발생할 수 있으므로, 실제 운영 시에는 이벤트 ID를 사용하는 방식으로 개선하는 것을 고려해 보