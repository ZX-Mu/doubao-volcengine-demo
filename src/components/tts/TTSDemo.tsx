import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { Play, Square, Download, MessageSquare } from 'lucide-react';
import { useTTS } from '../../hooks/useTTS';
import { useTTSWsUnidirectional } from '../../hooks/useTTSWsUnidirectional';
import { useTTSWsBidirectional } from '../../hooks/useTTSWsBidirectional';
import { TTS_MODE_IDS } from '../../utils/ttsMode';

const TTS_MODES = [
  { id: TTS_MODE_IDS.SSE_V3, name: '单向流式模式（HTTP SSE V3）', resourceId: 'seed-tts-2.0', implemented: true },
  { id: TTS_MODE_IDS.WS_UNIDIRECTIONAL_V3, name: '单向流式模式（WebSocket V3 Proxy）', resourceId: 'seed-tts-2.0', implemented: true },
  { id: TTS_MODE_IDS.WS_BIDIRECTIONAL_V3, name: '双向流式模式（WebSocket V3 Proxy）', resourceId: 'seed-tts-2.0', implemented: true },
  { id: TTS_MODE_IDS.WS_UNIDIRECTIONAL_DIRECT, name: '单向流式模式（WebSocket V3 直连）', resourceId: 'seed-tts-2.0', implemented: true },
  { id: TTS_MODE_IDS.WS_BIDIRECTIONAL_DIRECT, name: '双向流式模式（WebSocket V3 直连）', resourceId: 'seed-tts-2.0', implemented: true },
];

type SpeakerOption = {
  id: string;
  name: string;
  category: string;
  locale: string;
  capabilities: string;
};

const SPEAKERS: SpeakerOption[] = [
  // 通用场景
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0', category: '通用场景', locale: '语种：中文、日文、印尼、墨西哥西班牙语；方言：四川、陕西、东北', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_m191_uranus_bigtts', name: '云舟 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_taocheng_uranus_bigtts', name: '小天 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_liufei_uranus_bigtts', name: '刘飞 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_sophie_uranus_bigtts', name: '魅力苏菲 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_tianmeixiaoyuan_uranus_bigtts', name: '甜美小源 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_tianmeitaozi_uranus_bigtts', name: '甜美桃子 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_linjianvhai_uranus_bigtts', name: '邻家女孩 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_jitangnv_uranus_bigtts', name: '鸡汤女 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_wenroumama_uranus_bigtts', name: '温柔妈妈 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_jieshuoxiaoming_uranus_bigtts', name: '解说小明 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_tvbnv_uranus_bigtts', name: 'TVB女声 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_yizhipiannan_uranus_bigtts', name: '译制片男 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_qiaopinv_uranus_bigtts', name: '俏皮女声 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_linjiananhai_uranus_bigtts', name: '邻家男孩 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_wennuanahu_uranus_bigtts', name: '温暖阿虎/Alvin 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_naiqimengwa_uranus_bigtts', name: '奶气萌娃 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_popo_uranus_bigtts', name: '婆婆 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_gaolengyujie_uranus_bigtts', name: '高冷御姐 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_lanyinmianbao_uranus_bigtts', name: '懒音绵宝 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_fanjuanqingnian_uranus_bigtts', name: '反卷青年 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_huolixiaoge_uranus_bigtts', name: '活力小哥 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_mengyatou_uranus_bigtts', name: '萌丫头/Cutey 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_tiexinnvsheng_uranus_bigtts', name: '贴心女声/Candy 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_jitangmei_uranus_bigtts', name: '鸡汤妹妹/Hope 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_cixingjieshuonan_uranus_bigtts', name: '磁性解说男声/Morgan 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_liangsangmengzai_uranus_bigtts', name: '亮嗓萌仔 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_kailangjiejie_uranus_bigtts', name: '开朗姐姐 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_gaolengchenwen_uranus_bigtts', name: '高冷沉稳 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_zhuangzhou_uranus_bigtts', name: '庄周 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_ganmaodianyin_uranus_bigtts', name: '感冒电音姐姐 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_nvleishen_uranus_bigtts', name: '女雷神 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_qinqienv_uranus_bigtts', name: '亲切女声 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_kuailexiaodong_uranus_bigtts', name: '快乐小东 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_kailangxuezhang_uranus_bigtts', name: '开朗学长 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_youyoujunzi_uranus_bigtts', name: '悠悠君子 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_wenjingmaomao_uranus_bigtts', name: '文静毛毛 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_zhixingnv_uranus_bigtts', name: '知性女声 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_qingshuangnanda_uranus_bigtts', name: '清爽男大 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_yuanboxiaoshu_uranus_bigtts', name: '渊博小叔 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_yangguangqingnian_uranus_bigtts', name: '阳光青年 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_qingchezizi_uranus_bigtts', name: '清澈梓梓 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_tianmeiyueyue_uranus_bigtts', name: '甜美悦悦 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_xinlingjitang_uranus_bigtts', name: '心灵鸡汤 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_wenrouxiaoge_uranus_bigtts', name: '温柔小哥 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_roumeinvyou_uranus_bigtts', name: '柔美女友 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_dongfanghaoran_uranus_bigtts', name: '东方浩然 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_wenrouxiaoya_uranus_bigtts', name: '温柔小雅 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_gujie_uranus_bigtts', name: '顾姐 2.0', category: '通用场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },

  // 角色扮演
  { id: 'zh_female_qingxinnvsheng_uranus_bigtts', name: '清新女声 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_cancan_uranus_bigtts', name: '知性灿灿 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_sajiaoxuemei_uranus_bigtts', name: '撒娇学妹 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_zhishuaiyingzi_uranus_bigtts', name: '直率英子 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_silang_uranus_bigtts', name: '四郎 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_ruyaqingnian_uranus_bigtts', name: '儒雅青年 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_qingcang_uranus_bigtts', name: '擎苍 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_xionger_uranus_bigtts', name: '熊二 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_yingtaowanzi_uranus_bigtts', name: '樱桃丸子 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_aojiaobazong_uranus_bigtts', name: '傲娇霸总 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_wenroushunv_uranus_bigtts', name: '温柔淑女 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_gufengshaoyu_uranus_bigtts', name: '古风少御 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_shenyeboke_uranus_bigtts', name: '深夜播客 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_lubanqihao_uranus_bigtts', name: '鲁班七号 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_jiaochuannv_uranus_bigtts', name: '娇喘女声 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_linxiao_uranus_bigtts', name: '林潇 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_lingling_uranus_bigtts', name: '玲玲姐姐 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_chunribu_uranus_bigtts', name: '春日部姐姐 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_tangseng_uranus_bigtts', name: '唐僧 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_kailangdidi_uranus_bigtts', name: '开朗弟弟 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_zhubajie_uranus_bigtts', name: '猪八戒 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_chanmeinv_uranus_bigtts', name: '谄媚女声 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_tiancaitongsheng_uranus_bigtts', name: '天才童声 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_wuzetian_uranus_bigtts', name: '武则天 2.0', category: '角色扮演', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'saturn_zh_female_tiaopigongzhu_tob', name: '调皮公主', category: '角色扮演', locale: '中文', capabilities: '指令遵循、COT/QA功能' },
  { id: 'saturn_zh_female_keainvsheng_tob', name: '可爱女生', category: '角色扮演', locale: '中文', capabilities: '指令遵循、COT/QA功能' },
  { id: 'saturn_zh_male_shuanglangshaonian_tob', name: '爽朗少年', category: '角色扮演', locale: '中文', capabilities: '指令遵循、COT/QA功能' },
  { id: 'saturn_zh_male_tiancaitongzhuo_tob', name: '天才同桌', category: '角色扮演', locale: '中文', capabilities: '指令遵循、COT/QA功能' },
  { id: 'saturn_zh_female_cancan_tob', name: '知性灿灿', category: '角色扮演', locale: '中文', capabilities: '指令遵循、COT/QA功能' },

  // 视频配音
  { id: 'zh_female_shuangkuaisisi_uranus_bigtts', name: '爽快思思 2.0', category: '视频配音', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_peiqi_uranus_bigtts', name: '佩奇猪 2.0', category: '视频配音', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_sunwukong_uranus_bigtts', name: '猴哥 2.0', category: '视频配音', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_dayi_uranus_bigtts', name: '大壹 2.0', category: '视频配音', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_mizai_uranus_bigtts', name: '黑猫侦探社咪仔 2.0', category: '视频配音', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_meilinvyou_uranus_bigtts', name: '魅力女友 2.0', category: '视频配音', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_liuchangnv_uranus_bigtts', name: '流畅女声 2.0', category: '视频配音', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },

  // 教育场景
  { id: 'zh_female_yingyujiaoxue_uranus_bigtts', name: 'Tina老师 2.0', category: '教育场景', locale: '中文、英式英语', capabilities: '情感变化、指令遵循、ASMR' },

  // 客服场景
  { id: 'zh_female_kefunvsheng_uranus_bigtts', name: '暖阳女声 2.0', category: '客服场景', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'saturn_zh_female_qingyingduoduo_cs_tob', name: '轻盈朵朵 2.0', category: '客服场景', locale: '中文', capabilities: '指令遵循' },
  { id: 'saturn_zh_female_wenwanshanshan_cs_tob', name: '温婉珊珊 2.0', category: '客服场景', locale: '中文', capabilities: '指令遵循' },
  { id: 'saturn_zh_female_reqingaina_cs_tob', name: '热情艾娜 2.0', category: '客服场景', locale: '中文', capabilities: '指令遵循' },
  { id: 'saturn_zh_male_qingxinmumu_cs_tob', name: '清新沐沐 2.0', category: '客服场景', locale: '中文', capabilities: '指令遵循' },

  // 有声阅读
  { id: 'zh_female_xiaoxue_uranus_bigtts', name: '儿童绘本 2.0', category: '有声阅读', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_baqiqingshu_uranus_bigtts', name: '霸气青叔 2.0', category: '有声阅读', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_xuanyijieshuo_uranus_bigtts', name: '悬疑解说 2.0', category: '有声阅读', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_male_guanggaojieshuo_uranus_bigtts', name: '广告解说 2.0', category: '有声阅读', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'zh_female_shaoergushi_uranus_bigtts', name: '少儿故事 2.0', category: '有声阅读', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },

  // 多语种
  { id: 'zh_male_ruyayichen_uranus_bigtts', name: '儒雅逸辰 2.0', category: '多语种', locale: '中文', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'en_male_tim_uranus_bigtts', name: 'Tim', category: '多语种', locale: '美式英语', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'en_female_dacey_uranus_bigtts', name: 'Dacey', category: '多语种', locale: '美式英语', capabilities: '情感变化、指令遵循、ASMR' },
  { id: 'en_female_stokie_uranus_bigtts', name: 'Stokie', category: '多语种', locale: '美式英语', capabilities: '情感变化、指令遵循、ASMR' },
];

export default function TTSDemo({ config, onLog }: { config: any; onLog: (type: string, msg: string) => void }) {
    const [text, setText] = useState('今天天气可好了，我打算和朋友一起去野餐，带上美食和饮料，找个舒适的草坪，什么烦恼都没了。你要不要和我们一起呀？');
    const [ttsMode, setTtsMode] = useState(TTS_MODES[0]);
    const [resourceId, setResourceId] = useState(TTS_MODES[0].resourceId);
    const [selectedSpeaker, setSelectedSpeaker] = useState(SPEAKERS[0]);
    const [simulateStreamingInput, setSimulateStreamingInput] = useState(true);
    const [streamChunkSize, setStreamChunkSize] = useState(6);
    const [streamDelayMs, setStreamDelayMs] = useState(80);

    const sseTts = useTTS();
    const wsTts = useTTSWsUnidirectional();
    const wsBidirectionalTts = useTTSWsBidirectional();
    const stopSse = sseTts.stop;
    const stopWs = wsTts.stop;
    const stopWsBidirectional = wsBidirectionalTts.stop;
    const isWsUnidirectionalMode = ttsMode.id === TTS_MODE_IDS.WS_UNIDIRECTIONAL_V3 || ttsMode.id === TTS_MODE_IDS.WS_UNIDIRECTIONAL_DIRECT;
    const isWsBidirectionalMode = ttsMode.id === TTS_MODE_IDS.WS_BIDIRECTIONAL_V3 || ttsMode.id === TTS_MODE_IDS.WS_BIDIRECTIONAL_DIRECT;
    const isDirect = ttsMode.id === TTS_MODE_IDS.WS_UNIDIRECTIONAL_DIRECT || ttsMode.id === TTS_MODE_IDS.WS_BIDIRECTIONAL_DIRECT;
    const activeTts = isWsBidirectionalMode ? wsBidirectionalTts : isWsUnidirectionalMode ? wsTts : sseTts;
    const { speak, stop, isPlaying, error, audioUrl, fileName, chunkCount, audioByteLength, sentences, metrics, currentTimeSec } = activeTts;
    const inputChunks = isWsBidirectionalMode ? wsBidirectionalTts.inputChunks : [];
    const onLogRef = useRef(onLog);
    useEffect(() => { onLogRef.current = onLog; });
    const stableLog = useCallback((type: string, msg: string) => onLogRef.current(type, msg), []);
    const lastChunkCountRef = useRef(0);
    const lastSentenceCountRef = useRef(0);
    const lastInputChunkCountRef = useRef(0);

    useEffect(() => () => {
        stopSse();
        stopWs();
        stopWsBidirectional();
    }, [stopSse, stopWs, stopWsBidirectional]);

    useEffect(() => {
        if (error) stableLog('Error', error);
    }, [error, stableLog]);

    useEffect(() => {
        if (chunkCount > 0 && chunkCount !== lastChunkCountRef.current) {
            lastChunkCountRef.current = chunkCount;
            stableLog('TTS', `${isWsBidirectionalMode ? (isDirect ? 'WS-BIDI-DIRECT' : 'WS-BIDI') : isWsUnidirectionalMode ? (isDirect ? 'WS-DIRECT' : 'WS') : 'SSE'} audio chunks received: ${chunkCount}`);
        }
    }, [chunkCount, isWsBidirectionalMode, isWsUnidirectionalMode, stableLog]);

    useEffect(() => {
        if (audioByteLength > 0) {
            stableLog('TTS', `Merged audio bytes: ${audioByteLength}`);
        }
    }, [audioByteLength, stableLog]);

    useEffect(() => {
        if (metrics.firstChunkMs !== null) {
            stableLog('TTS', `First audio chunk in ${metrics.firstChunkMs.toFixed(0)}ms`);
        }
    }, [metrics.firstChunkMs, stableLog]);

    useEffect(() => {
        if (metrics.firstPlaybackMs !== null) {
            stableLog('TTS', `First audible playback in ${metrics.firstPlaybackMs.toFixed(0)}ms`);
        }
    }, [metrics.firstPlaybackMs, stableLog]);

    useEffect(() => {
        if (audioUrl) {
            stableLog('Success', 'TTS 音频流接收完成');
        }
    }, [audioUrl, stableLog]);

    useEffect(() => {
        if (sentences.length > lastSentenceCountRef.current) {
            const latest = sentences[sentences.length - 1];
            lastSentenceCountRef.current = sentences.length;
            stableLog(
                'TTS',
                `Timestamp sentence ${sentences.length}: ${latest.text} (${latest.words.length} words)`,
            );
            stableLog(
                'TTS',
                latest.words
                    .map((word) => `${word.word}[${word.startTime.toFixed(3)}-${word.endTime.toFixed(3)}]`)
                    .join(' '),
            );
        }
    }, [sentences, stableLog]);

    useEffect(() => {
        if (!isWsBidirectionalMode) {
            return;
        }

        if (inputChunks.length > lastInputChunkCountRef.current) {
            const latestIndex = inputChunks.length - 1;
            const latestChunk = inputChunks[latestIndex];
            lastInputChunkCountRef.current = inputChunks.length;
            stableLog('TTS', `Simulated input chunk ${inputChunks.length}: ${latestChunk}`);
        }
    }, [inputChunks, isWsBidirectionalMode, stableLog]);

    const handleSpeak = () => {
        if (!ttsMode.implemented) {
            stableLog('Error', `${ttsMode.name} 尚未按官方文档校对完成，当前只支持 HTTP SSE 单向流式-V3`);
            return;
        }

        if (isPlaying) {
            stableLog('Info', 'TTS playback stopped.');
            stop();
        } else {
            stopSse();
            stopWs();
            stopWsBidirectional();
            lastChunkCountRef.current = 0;
            lastSentenceCountRef.current = 0;
            lastInputChunkCountRef.current = 0;
            stableLog('TTS', `[${isWsBidirectionalMode ? (isDirect ? 'WS-BIDI-DIRECT' : 'WS-BIDI-V3') : isWsUnidirectionalMode ? (isDirect ? 'WS-DIRECT' : 'WS-V3') : 'SSE-V3'}] Requesting ${ttsMode.name} for ${text.length} characters...`);
            if (isWsBidirectionalMode && simulateStreamingInput) {
                stableLog('TTS', `Bidirectional input simulation enabled: chunk=${streamChunkSize}, delay=${streamDelayMs}ms`);
            }
            speak(text, {
                appId: config.appId,
                token: config.token,
                resourceId,
                voiceType: selectedSpeaker.id,
                speechRate: 0,
                pitchRate: 0,
                loudnessRate: 0,
                simulateStreamingInput,
                streamChunkSize,
                streamDelayMs,
                direct: isDirect,
            });
        }
    };

    const renderHighlightedSentence = (sentence: typeof sentences[number], sentenceIndex: number) => (
        <p key={`${sentenceIndex}-${sentence.text}`} className="text-sm leading-relaxed text-[#1D2129]">
            {sentence.words.map((word, wordIndex) => {
                const isActive = currentTimeSec >= word.startTime && currentTimeSec < word.endTime;
                const isDone = currentTimeSec >= word.endTime;

                return (
                    <span
                        key={`${sentenceIndex}-${wordIndex}-${word.word}`}
                        className={`transition-colors ${
                            isActive
                                ? 'bg-primary text-white rounded px-0.5'
                                : isDone
                                    ? 'text-primary'
                                    : 'text-[#4E5969]'
                        }`}
                    >
                        {word.word}
                    </span>
                );
            })}
        </p>
    );

    return (
        <div className="h-full flex flex-col p-5 bg-white border-l border-border-main">
            <div className="panel-title text-base font-bold text-[#1D2129] mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                豆包语音合成大模型 2.0
            </div>

            <textarea
                className="h-24 w-full shrink-0 bg-white border border-border-main rounded-lg p-4 text-sm text-[#4E5969] leading-relaxed resize-none focus:border-primary outline-none transition-all mb-4"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="请输入需要合成的文本..."
            />

            <div className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-text-secondary uppercase">合成模式</label>
                        <select
                            className="bg-bg-sub border border-border-main rounded px-2 py-1.5 text-xs font-medium outline-none"
                            value={ttsMode.id}
                            onChange={(e) => {
                                const next = TTS_MODES.find((item) => item.id === e.target.value) ?? TTS_MODES[0];
                                stopSse();
                                stopWs();
                                stopWsBidirectional();
                                lastChunkCountRef.current = 0;
                                setTtsMode(next);
                                setResourceId(next.resourceId);
                            }}
                        >
                            {TTS_MODES.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.implemented ? item.name : `${item.name}（待实现）`}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-text-secondary uppercase">资源 ID</label>
                        <div className="bg-bg-sub border border-border-main rounded px-2 py-1.5 text-xs font-medium text-[#4E5969]">
                            {resourceId}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-text-secondary uppercase">音色设置</label>
                        <select 
                            className="bg-bg-sub border border-border-main rounded px-2 py-1.5 text-xs font-medium outline-none"
                            value={selectedSpeaker.id}
                            onChange={(e) => setSelectedSpeaker(SPEAKERS.find(s => s.id === e.target.value) || SPEAKERS[0])}
                        >
                            {Array.from(new Set(SPEAKERS.map(s => s.category))).map(category => (
                                <optgroup key={category} label={category}>
                                    {SPEAKERS.filter(s => s.category === category).map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                        <div className="text-[10px] text-text-secondary bg-white border border-border-main rounded px-2 py-2">
                            <span className="font-semibold text-[#1D2129]">语种/方言：</span>
                            <span>{selectedSpeaker.locale}</span>
                        </div>
                        <p className="text-[10px] text-text-secondary">
                            当前已按你提供的清单扩展为完整测试音色列表，可直接逐个切换验证效果。
                        </p>
                    </div>
                </div>

                {isWsBidirectionalMode && (
                    <div className="grid grid-cols-3 gap-3">
                        <label className="flex items-center gap-2 bg-bg-sub border border-border-main rounded px-3 py-2 text-xs text-[#1D2129]">
                            <input
                                type="checkbox"
                                checked={simulateStreamingInput}
                                onChange={(e) => setSimulateStreamingInput(e.target.checked)}
                            />
                            模拟 Agent 流式输入
                        </label>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-bold text-text-secondary uppercase">单段长度</label>
                            <input
                                type="number"
                                min={1}
                                max={100}
                                value={streamChunkSize}
                                onChange={(e) => setStreamChunkSize(Math.max(1, Number(e.target.value) || 1))}
                                className="bg-bg-sub border border-border-main rounded px-2 py-1.5 text-xs font-medium outline-none"
                                disabled={!simulateStreamingInput}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-bold text-text-secondary uppercase">发送间隔(ms)</label>
                            <input
                                type="number"
                                min={30}
                                max={5000}
                                step={10}
                                value={streamDelayMs}
                                onChange={(e) => setStreamDelayMs(Math.max(30, Number(e.target.value) || 30))}
                                className="bg-bg-sub border border-border-main rounded px-2 py-1.5 text-xs font-medium outline-none"
                                disabled={!simulateStreamingInput}
                            />
                        </div>
                    </div>
                )}

                    <div className="bg-bg-sub rounded-lg p-3 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSpeak}
                            disabled={!config.appId}
                            className={`h-9 px-6 rounded font-semibold text-sm transition-all flex items-center gap-2 ${
                                isPlaying 
                                ? 'bg-red-500 text-white hover:bg-red-600' 
                                : 'bg-primary text-white hover:brightness-110 shadow-sm'
                            } disabled:opacity-50`}
                        >
                            {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                            {isPlaying ? '停止' : '立即开始合成'}
                        </button>
                        <a
                            href={audioUrl ?? undefined}
                            download={fileName}
                            className={`h-9 px-4 rounded border border-border-main text-xs font-medium bg-white transition-colors inline-flex items-center gap-2 ${
                                audioUrl ? 'text-[#4E5969] hover:bg-gray-50' : 'text-[#C9CDD4] pointer-events-none'
                            }`}
                        >
                            <Download className="w-3.5 h-3.5" />
                            下载音频
                        </a>
                    </div>

                    <div className="flex items-center gap-4 py-1">
                        <button className="w-8 h-8 rounded-full bg-white border border-border-main flex items-center justify-center text-primary shadow-sm">
                             {isPlaying ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
                        </button>
                        <div className="flex-1 h-1 bg-[#D1D5DB] rounded-full relative overflow-hidden">
                            <motion.div 
                                animate={isPlaying ? { width: ['0%', '100%'] } : { width: '0%' }}
                                transition={isPlaying ? { duration: 5, repeat: Infinity } : {}}
                                className="absolute inset-y-0 left-0 bg-primary"
                            />
                        </div>
                        <span className="text-[10px] font-mono text-text-secondary">
                            {chunkCount > 0 ? `${chunkCount} chunks` : 'waiting'}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white border border-border-main rounded px-3 py-2">
                            <div className="text-[10px] font-bold text-text-secondary uppercase">首包到达</div>
                            <div className="mt-1 text-sm font-mono text-[#1D2129]">
                                {metrics.firstChunkMs !== null ? `${metrics.firstChunkMs.toFixed(0)} ms` : '--'}
                            </div>
                        </div>
                        <div className="bg-white border border-border-main rounded px-3 py-2">
                            <div className="text-[10px] font-bold text-text-secondary uppercase">首次出声</div>
                            <div className="mt-1 text-sm font-mono text-[#1D2129]">
                                {metrics.firstPlaybackMs !== null ? `${metrics.firstPlaybackMs.toFixed(0)} ms` : '--'}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-border-main rounded-lg p-3 flex flex-col gap-2 max-h-56 overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-text-secondary uppercase">字幕跟随</span>
                            <span className="text-[10px] font-mono text-text-secondary">
                                {sentences.length > 0 ? `${currentTimeSec.toFixed(2)}s` : 'waiting'}
                            </span>
                        </div>
                        {sentences.length === 0 ? (
                            <p className="text-[11px] text-text-secondary leading-relaxed">
                                页面现在只展示播放中的字幕高亮效果。详细字级时间戳已输出到下方运行控制台，便于你直接检查返回内容。
                            </p>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {sentences.map((sentence, index) => (
                                    <div key={`${index}-${sentence.text}`} className="rounded border border-border-main bg-bg-sub px-3 py-2">
                                        {renderHighlightedSentence(sentence, index)}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
