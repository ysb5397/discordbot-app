const mongoose = require('mongoose');

const interactionSchema = new mongoose.Schema({
    interactionId: { type: String, required: true, unique: true },
    channelId: { type: String },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    type: {
        type: String,
        enum: ['MESSAGE', 'MENTION', 'VOICE', 'ERROR', 'EARTHQUAKE'],
        required: true
    },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    botResponse: { type: String },
    timestamp: { type: Date, default: Date.now }
});

interactionSchema.index({ userId: 1, type: 1, timestamp: -1 });

const apiKeySchema = new mongoose.Schema({
    keyName: { type: String, required: true, unique: true }, // "Flutter App", "Admin Tool"
    apiKey: { type: String, required: true, unique: true }, // 실제 키 (key-v1-abc)
    isActive: { type: Boolean, default: true }, // "ALLOWED_API_KEYS" 목록에 포함되는지? (부드러운 전환용)
    isCurrent: { type: Boolean, default: false } // "/api/config"가 나눠줄 키인지?
});

const ApiKey = mongoose.model('ApiKey', apiKeySchema);

const deploymentStatusSchema = new mongoose.Schema({
    commitSha: { type: String, required: true, unique: true }, // GitHub 커밋 해시
    commandsRegistered: { type: Boolean, default: false }, // 명령어 등록 성공 여부
    timestamp: { type: Date, default: Date.now }
});

const DeploymentStatus = mongoose.model('DeploymentStatus', deploymentStatusSchema);

const Interaction = mongoose.model('Interaction', interactionSchema);

const urlsSchema = new mongoose.Schema({
    url: { type: String, required: true, unique: true }, // 검사한 URL
    isSafe: { type: Boolean, required: true }, // 안전한지 여부
    lastChecked: { type: Date, default: Date.now } // 마지막 검사 시각
});

const Urls = mongoose.model('Url', urlsSchema);

const botStatusSchema = new mongoose.Schema({
    botName: { type: String, required: true, unique: true },
    status: { type: String, default: 'INACTIVE' },
    lastHeartbeat: { type: Date, default: Date.now }
});

const BotStatus = mongoose.model('BotStatus', botStatusSchema);

const connectDB = async () => {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
        console.error('오류: MONGODB_URI 환경 변수가 설정되지 않았습니다. .env 파일을 확인해주세요.');
        return; 
    }

    try {
        await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
        console.log('성공적으로 MongoDB에 연결되었습니다! ✅');
    } catch (err) {
        console.error('MongoDB 연결에 실패했습니다... 😭', err);
        throw err; 
    }
};

const disconnectDB = async () => {
    try {
        await mongoose.disconnect();
        console.log('MongoDB 연결이 성공적으로 종료되었습니다. 🛑');
    } catch (err) {
        console.error('MongoDB 연결 종료 중 오류 발생:', err);
        throw err;
    }
};

const reconnectDB = async () => {
    console.log('MongoDB 재연결을 시도합니다...');
    await disconnectDB();
    await connectDB();
};

module.exports = {
    Interaction,
    ApiKey,
    DeploymentStatus,
    connectDB,
    disconnectDB,
    reconnectDB,
    Urls,
    BotStatus
};
