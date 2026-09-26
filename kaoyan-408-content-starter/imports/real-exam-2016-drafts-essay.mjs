// V14 内容生产轨 — 2016 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。
// rubric 遵循 rubric-v1 JSON 规范（totalPoints = Σ criteria.points）。
// ⚠ 2016 各大题官方单题分值待官方分值表（bundle 中 score=null）：以下 totalPoints 与
//   子问分值拆分为草稿拟定（合计 70 分，与 40×2+70=150 卷面结构一致），解析中已显式标注「待核」。
// Q41 引用题 33~41 拓扑图（关键地址已随题面保留）。
export const draftsEssay = {
  41: {
    analysis:
      '(1) TCP 三次握手第二次握手（S→H3）：**SYN = 1、ACK = 1**（同时置同步与确认位）；\n' +
      '确认序号 = H3 初始序号 + 1 = 100 + 1 = **101**。\n' +
      '(2) H3 的 cwnd 从 1KB 起、阈值 32KB，慢启动阶段每经过一个 RTT 翻倍：\n' +
      'RTT1 发 1KB（发完 cwnd=2）；RTT2 发 2KB（cwnd=4）；RTT3 发 4KB（cwnd=8）；RTT4 发 8KB。\n' +
      '确认按段累计：RTT1~RTT4 已确认段数 1、3、7、15 → **第 8 个确认段**出现在 RTT4 中第 1 段被确认时：\n' +
      '· 此时 S 端已缓存 8KB → 通告接收窗口 rwnd = 20 − 8 = **12KB**；\n' +
      '· 慢启动每收到一个确认 cwnd 增加 1KB：RTT4 内收到 1 个确认后 cwnd = 8 + 1 = **9KB**；\n' +
      '· 发送窗口 = min(cwnd, rwnd) = min(9, 12) = **9KB**。\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) SYN=1、ACK=1、确认序号 101', points: 3,
          evidenceHint: '答案给出 SYN/ACK 取值与 101',
          matchAny: ['101', 'SYN', 'ACK'],
        },
        {
          id: 'c2', description: '(2) 第 8 个确认通告接收窗口 12KB（20−8）', points: 2,
          evidenceHint: '答案给出 12KB',
          matchAny: ['12'],
        },
        {
          id: 'c3', description: '(2) 此时拥塞窗口 9KB（慢启动逐确认加 1）', points: 2,
          evidenceHint: '答案给出 9KB 及慢启动推导',
          matchAny: ['9', '慢启动'],
        },
        {
          id: 'c4', description: '(2) 发送窗口 = min(cwnd, rwnd) = 9KB', points: 2,
          evidenceHint: '答案给出 9KB 及取小规则',
          matchAny: ['9', 'min'],
        },
      ],
    },
  },
  42: {
    analysis:
      '(1) 设非叶结点 m 个、叶结点 L 个。树中总边数 = 结点总数 − 1 = (m + L) − 1；\n' +
      '又每个非叶结点恰有 k 个孩子 → 边数 = k·m。故 km = m + L − 1 →\n' +
      '**L = (k−1)·m + 1**。\n' +
      '(2) 高度为 h（单结点树 h=1）：\n' +
      '· 最多：每层结点都是满的——第 i 层 k^(i−1) 个 → 结点数 = k⁰+k¹+…+k^(h−1) = **(k^h − 1)/(k−1)**；\n' +
      '· 最少：前 h−1 层每层只有 1 个结点（一条链），第 h−1 层的那个非叶结点带 k 个叶孩子 →\n' +
      '  结点数 = (h−1) + k（h=1 的特例为 1 个）。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) 叶结点数 L = (k−1)m + 1，推导过程完整', points: 3,
          evidenceHint: '答案给出公式及边数关系推导',
          matchAny: ['(k−1)', 'k−1', '边'],
        },
        {
          id: 'c2', description: '(2) 最多 (k^h − 1)/(k−1)', points: 2,
          evidenceHint: '答案给出等比求和结果',
          matchAny: ['k^h', 'kh', '等比'],
        },
        {
          id: 'c3', description: '(2) 最少 (h−1) + k', points: 3,
          evidenceHint: '答案给出 (h−1)+k 或等价表达',
          matchAny: ['h−1', 'k'],
        },
      ],
    },
  },
  43: {
    analysis:
      '(1) 基本设计思想：|n1−n2| 最小要求两部分元素个数分别为 ⌊n/2⌋ 与 ⌈n/2⌉；在此前提下 |S1−S2| 最大\n' +
      '要求小的那部分由**最小的 ⌊n/2⌋ 个元素**组成。因此只需找出第 ⌈n/2⌉ 小的元素并把数组原地划分成两半——\n' +
      '借鉴**快速排序的枢轴划分**：随机/取首元素为枢轴做一次 partition，若枢轴恰好落在位置 ⌊n/2⌋\n' +
      '（0 基下标 n/2−1 或 n/2），划分即告完成；否则只对包含目标位置的一侧递归（快速选择思想），\n' +
      '不追求完全有序。\n' +
      '(2) 代码（C 语言）：\n' +
      'int partition(int a[], int low, int high) {      // 一次划分，返回枢轴最终位置\n' +
      '    int pivot = a[low];\n' +
      '    while (low < high) {\n' +
      '        while (low < high && a[high] >= pivot) high--;\n' +
      '        a[low] = a[high];\n' +
      '        while (low < high && a[low] <= pivot) low++;\n' +
      '        a[high] = a[low];\n' +
      '    }\n' +
      '    a[low] = pivot;  return low;\n' +
      '}\n' +
      'void divide(int a[], int n) {\n' +
      '    int mid = n / 2, low = 0, high = n - 1, pos;\n' +
      '    while (1) {\n' +
      '        pos = partition(a, low, high);           // 快速选择：只递归目标一侧\n' +
      '        if (pos == mid) break;\n' +
      '        else if (pos > mid) high = pos - 1;\n' +
      '        else low = pos + 1;\n' +
      '    }                                            // a[0..mid-1] 即 A1（小的一半）\n' +
      '}\n' +
      '(3) 时间复杂度平均 O(n)（每轮只处理一侧，规模期望折半）；空间复杂度 O(1)（原地划分，不计递归栈则为 O(log n)）。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 思想正确：个数各半 + 小的一半取最小 ⌊n/2⌋ 个（快排划分/快速选择）', points: 4,
          evidenceHint: '答案说明枢轴划分与中位位置',
          matchAny: ['划分', '枢轴', '快排', 'n/2'],
        },
        {
          id: 'c2', description: '(2) 代码正确：partition 划分与目标位置收敛循环', points: 5,
          evidenceHint: '代码含 partition 与 mid 收敛循环',
          matchAny: ['partition', 'while', 'pivot'],
        },
        {
          id: 'c3', description: '(2) 关键处有简要注释', points: 1,
          evidenceHint: '代码含注释',
          matchAny: ['//', '/*'],
        },
        {
          id: 'c4', description: '(3) 时间 O(n)、空间 O(1)（或 O(log n) 计栈）', points: 3,
          evidenceHint: '答案给出两个复杂度结论',
          matchAny: ['O(n)', 'O(1)'],
        },
      ],
    },
  },
  44: {
    analysis:
      '(1) 每字符含：1 起始位 + 7 数据位 + 1 奇校验位 + 1 停止位 = **10 位**。\n' +
      '设备从启动到字符送入端口需 0.5ms → 每秒最多送入 1/0.5ms = **2000 个字符**。\n' +
      '(2) CPU 主频 50MHz、CPI 4：\n' +
      '· 完成任务（1000 个字符）所需时间 ≈ 1000 × 0.5ms = 0.5s = **25×10⁶ 个时钟周期**（受设备速率约束）；\n' +
      '· 每字符 CPU 开销 = 中断响应 10 周期 + 服务程序 20 条指令 × CPI 4 = 80 周期，共 90 周期 →\n' +
      '  CPU 用于该任务 ≈ 1000 × 90 = **9×10⁴ 个时钟周期**（其余时间 CPU 可执行其他程序）；\n' +
      '· 中断响应阶段 CPU 的操作：**关中断、保存断点（PC）压栈/存入指定单元、由中断向量引出中断服务程序\n' +
      '  入口地址并送 PC**（均为硬件隐指令完成）。\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 每字符 10 位（1+7+1+1）、每秒 2000 字符', points: 3,
          evidenceHint: '答案给出 10 位与 2000',
          matchAny: ['10', '2000'],
        },
        {
          id: 'c2', description: '(2) 完成任务约 25×10⁶ 个时钟周期（1000×0.5ms）', points: 2,
          evidenceHint: '答案给出 25×10⁶ 或 0.5s',
          matchAny: ['25', '0.5'],
        },
        {
          id: 'c3', description: '(2) CPU 用于该任务约 9×10⁴ 周期（1000×(10+20×4)）', points: 2,
          evidenceHint: '答案给出 9×10⁴ 或 90000',
          matchAny: ['9×10', '90000', '90'],
        },
        {
          id: 'c4', description: '(2) 中断响应阶段操作：关中断、保存断点、引出服务程序入口送 PC', points: 2,
          evidenceHint: '答案列出三项隐指令操作',
          matchAny: ['关中断', '断点', '入口'],
        },
      ],
    },
  },
  45: {
    analysis:
      '基础参数：页 8KB → 页内偏移 13 位；虚地址 32 位 → 虚页号 = 19 位；物理地址 24 位 → 页框号 = 11 位。\n' +
      'Cache：数据区 64KB、2 路、块 64B → 组数 = 64KB/(2×64B) = 512 → 组号 9 位、块内 6 位 → Cache 标记 = 24−9−6 = 9 位。\n' +
      '(1) 字段位数：A（虚页号）= 19 位；B（TLB 标记，全相联）= **虚页号的全部 19 位**；C（页框号）= 11 位；\n' +
      '物理地址侧：Cache 标记 = 9 位、组号 = 9 位、块内偏移 = 6 位（对应 D/E/F 的具体字母按原卷图核对）。\n' +
      '(2) 主存块 4099 → 组号 = 4099 mod 512 = **3**；该行标记 H = ⌊4099/512⌋ = **8**。\n' +
      '(3) **Cache 缺失开销小**：缺失处理只须访问主存一次（硬件自动完成，几十~几百 ns 量级）；\n' +
      '**缺页开销大**：需要访问磁盘（ms 级）并由操作系统执行缺页处理程序，两者相差 4~5 个数量级。\n' +
      '(4) Cache 可用直写：CPU 与主存速度差距小（ns 级），写穿透的额外开销可接受，且保持主存一致性简单；\n' +
      '页面写回若采用直写则每条写指令都要写磁盘（ms 级），代价完全不可接受 → 必须先在内存中修改、\n' +
      '积累脏标志，淘汰时才一次性写回磁盘（回写）。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 字段位数：虚页号/TLB 标记 19、页框号 11、Cache 标记 9/组号 9/块内 6', points: 5,
          evidenceHint: '答案给出 19/19/11 与 9/9/6',
          matchAny: ['19', '11', '9', '6'],
        },
        {
          id: 'c2', description: '(1) TLB 标记 B 存放虚页号（全相联）', points: 1,
          evidenceHint: '答案说明 B 为虚页号',
          matchAny: ['虚页号'],
        },
        {
          id: 'c3', description: '(2) 组号 3、标记 H = 8', points: 3,
          evidenceHint: '答案给出组号 3 与标记 8',
          matchAny: ['3', '8'],
        },
        {
          id: 'c4', description: '(3) 缺页开销大（磁盘 + OS 介入）与 Cache 缺失（主存 + 硬件）对比', points: 2,
          evidenceHint: '答案对比磁盘与主存量级',
          matchAny: ['磁盘', '数量级', '操作系统'],
        },
        {
          id: 'c5', description: '(4) 直写可行因 ns 级差距、页面回写因 ms 级磁盘写代价', points: 2,
          evidenceHint: '答案说明两级速度差距与脏位回写',
          matchAny: ['直写', '回写', '脏'],
        },
      ],
    },
  },
  46: {
    analysis:
      '(1) priority = nice 为静态值：若高优先数（高优先级）进程源源不断地创建或长期驻留，\n' +
      '优先数大（低优先级）的进程将**永远选不中**——调度只看固定优先数、没有任何补偿机制 → 饥饿。\n' +
      '(2) 动态优先数设计：让「占用 CPU 越多优先数越大（降级）」、「等待越久优先数越小（升级）」：\n' +
      '**priority = nice + cpuTime/a − waitTime/b**（a、b 为正的调节系数，如 a=2、b=1）。\n' +
      '· cpuTime 增大 → priority 增大 → 运行久的进程优先级下降，给其他进程让出机会；\n' +
      '· waitTime 增大 → priority 减小 → 等待中的进程优先级持续上升，任何进程的优先数迟早降到最小而被调度，\n' +
      '  从而避免饥饿。\n' +
      '**waitTime 的作用**：对等待时间做补偿（ aging，老化），使低静态优先级的进程随等待逐步提升优先级，\n' +
      '是消除饥饿的关键项；同时与 cpuTime 形成动态平衡，兼顾公平与响应。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) 饥饿原因正确（静态优先数无补偿，低优先级进程永远选不中）', points: 3,
          evidenceHint: '答案说明高优先级持续存在时低优先级无法运行',
          matchAny: ['静态', '饥饿', '选不', '永远'],
        },
        {
          id: 'c2', description: '(2) 动态公式正确（nice + cpuTime 项 − waitTime 项）', points: 3,
          evidenceHint: '公式含 cpuTime 正项与 waitTime 负项',
          matchAny: ['cpuTime', 'waitTime', 'nice'],
        },
        {
          id: 'c3', description: '(2) waitTime 作用说明（老化补偿，保证最终被调度）', points: 2,
          evidenceHint: '答案说明等待补偿避免饥饿',
          matchAny: ['等待', '补偿', '饥饿', '老化'],
        },
      ],
    },
  },
  47: {
    analysis:
      '(1) 目录文件的内容 = 「文件名 + 起始簇号」：\n' +
      '· dir 的目录文件：dir1 → 48；file1 → 100；file2 → 200；\n' +
      '· dir1 的目录文件：file1 → 106。\n' +
      '(2) FAT 表项 2B → 簇号 16 位 → 簇号最大编址 2¹⁶ 个簇：\n' +
      '· FAT 最大长度 = 2¹⁶ × 2B = **128KB**；\n' +
      '· 该文件系统支持的文件最大长度 = 2¹⁶ 簇 × 4KB/簇 = **256MB**。\n' +
      '(3) file1 的簇链为 100 → 106 → 108（FAT 链接）：**106 存放在 FAT 的 100 号表项中**（100 号表项的值 = 106），\n' +
      '**108 存放在 FAT 的 106 号表项中**。\n' +
      '(4) 第 5000 字节落在 file1 的第 2 个簇（4096~8191 字节区间）→ 需要访问：\n' +
      '① dir1 的目录文件所在簇 **48**（dir 在内存中给出 dir1 起始簇 48，读簇 48 得 file1 的起始簇号 106）；\n' +
      '② file1 的第 2 数据簇 **106**（FAT 已在内存，查 FAT[100]=106 无需再访盘）→ 共访问 **48、106 两个簇**。\n' +
      '【各问分值为草稿拟定（本题合计 10 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) dir 与 dir1 的目录项内容正确（起始簇号 48/100/200/106）', points: 3,
          evidenceHint: '答案给出各文件的起始簇号',
          matchAny: ['48', '100', '200', '106'],
        },
        {
          id: 'c2', description: '(2) FAT 最大 128KB、文件最大 256MB', points: 3,
          evidenceHint: '答案给出 128KB 与 256MB',
          matchAny: ['128KB', '256MB'],
        },
        {
          id: 'c3', description: '(3) 106 在 FAT 的 100 号表项、108 在 106 号表项', points: 2,
          evidenceHint: '答案给出表项号对应关系',
          matchAny: ['100', '106'],
        },
        {
          id: 'c4', description: '(4) 访问簇 48（dir1 目录）与簇 106（file1 第二簇）', points: 2,
          evidenceHint: '答案给出 48 与 106',
          matchAny: ['48', '106'],
        },
      ],
    },
  },
};
