import type {
  SignalPrimaryBand,
  SignalSubFeeling,
} from "../signals/frequency-taxonomy.js";

export type SignalQualityFixture = {
  name: string;
  primaryBand: SignalPrimaryBand;
  sampleText: string;
  seedText: string;
  subFeeling: SignalSubFeeling;
};

export const signalQualityFixtures: SignalQualityFixture[] = [
  {
    name: "自我镜像 / 自我怀疑",
    primaryBand: "self_mirror",
    sampleText:
      "我在电梯镜面里整理领口，工牌翻到背面，忽然不想再确认今天有没有表现得像个可靠的人。",
    seedText: "我总觉得自己做得不够好。",
    subFeeling: "self_doubt",
  },
  {
    name: "情绪暗流 / 疲惫",
    primaryBand: "emotional_undercurrent",
    sampleText:
      "我在洗手池前拧紧水龙头，袖口沾了一圈冷水，才发现自己连叹气都压得很轻。",
    seedText: "我最近一直觉得很累。",
    subFeeling: "fatigue",
  },
  {
    name: "关系星云 / 被理解需求",
    primaryBand: "relationship_nebula",
    sampleText:
      "我把聊天框里的那句算了删掉，手机扣在桌上，杯里的冰化完了也没人问我刚才怎么停住。",
    seedText: "我想被理解，但又不想解释。",
    subFeeling: "need_to_be_understood",
  },
  {
    name: "时间星环 / 怀旧",
    primaryBand: "time_ring",
    sampleText:
      "我在旧相册里停在那张模糊合照，指尖把折角压平，像是还能把那个下午多留一分钟。",
    seedText: "我有点怀念以前的自己。",
    subFeeling: "nostalgia",
  },
  {
    name: "意义深空 / 目标迷失",
    primaryBand: "meaning_deep_space",
    sampleText:
      "我把待办清单重新抄了一遍，笔尖停在第一行，突然分不清自己是在往前走，还是只是在填满纸面。",
    seedText: "我不知道努力还有没有意义。",
    subFeeling: "goal_loss",
  },
  {
    name: "停滞轨道 / 启动困难",
    primaryBand: "stagnant_orbit",
    sampleText:
      "我坐在书桌前把文件命名了三次，鼠标指针停在空白页上，像在等我先承认还没准备好开始。",
    seedText: "我总是很难开始。",
    subFeeling: "starting_difficulty",
  },
  {
    name: "时代星群 / 工作异化",
    primaryBand: "era_cluster",
    sampleText:
      "我在工位关掉第三个提醒，键盘旁的咖啡已经凉了，屏幕上每个数字都像和我本人没什么关系。",
    seedText: "我在工作里越来越不像自己。",
    subFeeling: "work_alienation",
  },
];
