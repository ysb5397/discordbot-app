const mongoose = require('mongoose');
const config = require('../../config/manage_environments');

const MONGODB_URI = config.db.uri;

const interactionSchema = new mongoose.Schema({
    interactionId: { type: String, required: true },
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
    timestamp: { type: Date, default: Date.now },
    embedding: {
        type: [Number],
        required: false,
        index: true
    },
    isConsolidated: { type: Boolean, default: false },
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

const whiteListSchema = new mongoose.Schema({
    memberId: { type: String, required: true, unique: true },
    isWhite: { type: Boolean, required: true },
    timestamp: { type: Date, default: Date.now }
});

const WhiteList = mongoose.model('WhiteList', whiteListSchema);

const schedulerSchema = new mongoose.Schema({
    type: { type: String, required: true, enum: ['EARTHQUAKE', 'BRIEFING'] },
    guildId: { type: String, required: true },
    channelId: { type: String },
    scheduleValue: { type: String, required: true },
    extraData: { type: mongoose.Schema.Types.Mixed },
    isActive: { type: Boolean, default: true }
});
schedulerSchema.index({ guildId: 1, type: 1 }, { unique: true });

const SchedulerConfig = mongoose.model('SchedulerConfig', schedulerSchema);

const reportSchema = new mongoose.Schema({
    userId: { type: String, required: true }, // 누구의 기억인지
    summary: { type: String, required: true }, // 요약된 내용 (보고서)
    lastUpdatedAt: { type: Date, default: Date.now }
});

const MemoryReport = mongoose.model('MemoryReport', reportSchema);

const devProfileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    skills: { type: Map, of: Number, default: {} },
    weaknessTags: [String],
    lastTrainedAt: { type: Date, default: Date.now }
});

const DevProfile = mongoose.model('DevProfile', devProfileSchema);

const quizLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    topic: String,
    question: String,
    userAnswer: String,
    aiEvaluation: String,
    isCorrect: Boolean,
    difficulty: String,
    embedding: { type: [Number], index: true },
    timestamp: { type: Date, default: Date.now }
});

const QuizLog = mongoose.model('QuizLog', quizLogSchema);

const connectDB = async () => {
    const mongoURI = MONGODB_URI;
    if (!mongoURI) {
        console.error('오류: MONGODB_URI 환경 변수가 설정되지 않았습니다. .env 파일을 확인해주세요.');
        return;
    }

    try {
        await mongoose.connect(MONGODB_URI, { family: 4 });
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
    BotStatus,
    WhiteList,
    SchedulerConfig,
    MemoryReport,
    DevProfile,
    QuizLog
};
