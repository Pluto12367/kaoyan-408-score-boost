// V14 内容生产轨 — 2009 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。
// rubric 遵循 rubric-v1 JSON 规范（totalPoints = Σ criteria.points）。
// ⚠ 2026-09-26 rubric v2 修订：官方单题分值已观测（多源一致的公开真题转录原文标注，
//   证据见 scripts/generate-legacy-bundles.mjs ESSAY_SCORES 注释）——
//   41=10、42=15、43=8、44=13、45=7、46=8、47=9（合计 70，与卷面结构一致）。
//   仅总分变动的题（41/42/47）升 version=2 并重分摊 criteria.points；43-46 拟定值
//   恰与官方一致，保持 v1 不动（无内容变化不做假版本升级）。
// Q44 依赖原卷数据通路图、Q47 依赖拓扑图，采分点按文字化题面搭建，图数据待核对。
export const draftsEssay = {
  41: {
    analysis:
      '结论：该方法**不能**保证求得最短路径，需要举反例。\n' +
      '症结在步骤②：每步只选「离当前顶点 u 最近」的顶点，这是局部贪心；正确算法（Dijkstra）选取的应是\n' +
      '「离初始顶点集合距离最小」的顶点，并维护已确定最短距离的顶点集。局部最近 ≠ 全局最短，\n' +
      '且该方法一旦把某顶点加入路径便不能回退，错误的选择会一路带到底。\n' +
      '反例：设顶点 S、A、B、T，边 S→A=10，A→T=1，S→B=1，B→T=100。\n' +
      '真实最短路径 S→A→T = 11。按题给方法：u=S 时最近的未访问顶点是 B（距离 1）→ 加入 B；\n' +
      'u=B 时只能加入 T，得到路径 S→B→T = 1+100 = 101 ≠ 11，且无法回头修正 → 方法不可行。\n' +
      '【官方分值 10 分（v2）；官方子问拆分未知，v1 的 +2 分差均摊到反例构造与执行对比两个证据性采分点。】',
    rubric: {
      version: 2,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '明确回答「不能求得最短路径」（判断正确）', points: 2,
          evidenceHint: '答案明确给出否定结论',
          matchAny: ['不能', '无法', '不可以', '不能保证'],
        },
        {
          id: 'c2', description: '构造出具体反例（顶点、边权完整，最短路径确实绕开局部最近点）', points: 4,
          evidenceHint: '答案给出至少 4 个顶点与各边权值，且图中「离当前顶点最近的顶点」不在真实最短路径上',
          matchAny: ['反例', '顶点', '边'],
        },
        {
          id: 'c3', description: '按题给方法逐步执行得到非最短结果，并与真实最短路径对比说明', points: 4,
          evidenceHint: '答案展示贪心方法的执行结果（如 101）与真实最短值（如 11）的对比',
          matchAny: ['最短路径', '对比', '101', '局部'],
        },
      ],
    },
  },
  42: {
    analysis:
      '基本思想：双指针（快慢指针）一次遍历。设快指针 p 先沿链表走 k 步；随后两指针同步后移，\n' +
      '当快指针到达最后一个结点时，慢指针 q 恰好指向倒数第 k 个结点。全程只扫一遍链表，\n' +
      '时间 O(n)、额外空间 O(1)，无需事先知道表长，也不改变链表结构。\n' +
      '详细实现：① 从第一个结点起扫描，若走 k−1 步时就遇空（k 大于表长）→ 返回 0；\n' +
      '② 否则 p、q 分别从「已走 k−1 步的位置」与「表头」出发同步后移，直到 p 到达最后一个结点；\n' +
      '③ 此时 q 即倒数第 k 个结点，输出 q->data 并返回 1。注意带头结点：扫描应从 list->link 开始，\n' +
      '计数「倒数」以第一个数据结点为「倒数第 1 个」。\n' +
      '代码框架（C 语言）：\n' +
      'int searchK(LinkList list, int k) {\n' +
      '    Node *p = list->link, *q = list->link;   // p、q 均指向第一个数据结点\n' +
      '    for (int i = 1; i < k; i++) {            // p 先走 k-1 步\n' +
      '        if (p == NULL) return 0;             // k 超过表长\n' +
      '        p = p->link;\n' +
      '    }\n' +
      '    if (p == NULL) return 0;                 // k 恰等于表长时上面循环已到末尾前，此处兜底判空\n' +
      '    while (p->link != NULL) { p = p->link; q = q->link; }   // 同步后移\n' +
      '    printf("%d", q->data); return 1;         // q 即倒数第 k 个结点\n' +
      '}\n' +
      '【官方分值 15 分（v2）；官方子问拆分未知，v1 的 +2 分差加到思想与代码两个核心采分点。】',
    rubric: {
      version: 2,
      totalPoints: 15,
      criteria: [
        {
          id: 'c1', description: '(1) 双指针思想正确：两指针保持固定间距 k（或先走 k 步）一次遍历', points: 4,
          evidenceHint: '答案出现「两个指针」「相距 k」「一次遍历」等表述',
          matchAny: ['两个指针', '快慢', '相距', '先走', '一次遍历', '单趟'],
        },
        {
          id: 'c2', description: '(2) 实现步骤完整：先走 k−1 步、同步后移、末结点判定与输出返回约定', points: 4,
          evidenceHint: '答案描述了先行步数、同步移动与终止条件的完整步骤',
          matchAny: ['同步', '后移', '末尾', '返回'],
        },
        {
          id: 'c3', description: '(3) 代码正确：头结点处理、k>表长的判空返回 0、输出 data 并返回 1', points: 5,
          evidenceHint: '代码含判空分支、返回 0/1 与输出语句',
          matchAny: ['NULL', 'return 0', 'return 1', 'printf', 'list'],
        },
        {
          id: 'c4', description: '(3) 关键处有简要注释', points: 1,
          evidenceHint: '代码含 // 或 /* 注释',
          matchAny: ['//', '/*'],
        },
        {
          id: 'c5', description: '指出时间 O(n)、空间 O(1)（不计链表本身）', points: 1,
          evidenceHint: '答案给出复杂度结论',
          matchAny: ['O(n)', 'O(1)'],
        },
      ],
    },
  },
  43: {
    analysis:
      '(1) 中断方式：传输单位 32 位 = 4B，设备速率 0.5MB/s → 每秒中断次数 = 0.5MB ÷ 4B = 125000 次。\n' +
      '每次中断服务开销 = 18 条指令 + 折合 2 条指令的其他开销 = 20 条指令 × CPI 5 = 100 个时钟周期。\n' +
      '每秒用于该外设 I/O 的时钟周期 = 125000 × 100 = 12.5×10⁶；CPU 每秒总周期 = 500×10⁶。\n' +
      '占比 = 12.5/500 = 2.5%。\n' +
      '(2) DMA 方式：块大小 5000B、速率 5MB/s → 每秒 5MB ÷ 5000B = 1000 块。\n' +
      '每块的预处理+后处理 = 500 个时钟周期（数据传输由 DMA 控制器完成，不占 CPU）。\n' +
      '每秒 CPU 开销 = 1000 × 500 = 5×10⁵ 周期，占比 = 0.5×10⁶ / 500×10⁶ = 0.1%。\n' +
      '对比可见 DMA 将 CPU 占用从 2.5% 降到 0.1%。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) 中断次数计算正确（0.5MB/s ÷ 4B = 125000 次/秒）', points: 2,
          evidenceHint: '答案出现 125000 或等价算式',
          matchAny: ['125000', '12.5万', '125,000'],
        },
        {
          id: 'c2', description: '(1) 每次中断开销（20 条指令×5 周期=100 周期）与占比 2.5% 正确', points: 2,
          evidenceHint: '答案给出 100 周期/次与 2.5%',
          matchAny: ['2.5%', '100'],
        },
        {
          id: 'c3', description: '(2) DMA 块数计算正确（5MB/s ÷ 5000B = 1000 块/秒）', points: 2,
          evidenceHint: '答案出现 1000 块',
          matchAny: ['1000'],
        },
        {
          id: 'c4', description: '(2) CPU 占用百分比 0.1% 正确（500 周期 × 1000 块对照总周期）', points: 2,
          evidenceHint: '答案给出 0.1%',
          matchAny: ['0.1%'],
        },
      ],
    },
  },
  44: {
    analysis:
      '【原题依赖数据通路图，扁平化题面保留了控制信号名称，按文字化题面搭建；图数据待核对】\n' +
      '执行阶段目标：(R0)+((R1)) → (R1)。需先取主存操作数，经 ALU 相加后写回主存。节拍划分：\n' +
      'C5: MAR ← (R1)          — R1out, MARin（把目的操作数地址送 MAR）\n' +
      'C6: MDR ← M(MAR)        — MemR, MDRinE（读主存操作数）\n' +
      'C7: A ← (R0)            — R0out, Ain（暂存被加数）\n' +
      'C8: AC ← (A)+(MDR)      — MDRout, ADD, ACin（ALU 相加）\n' +
      'C9: MDR ← (AC)          — ACout, MDRin（结果送 MDR 准备写回）\n' +
      'C10: M(MAR) ← (MDR)     — MemW（写回 R1 所指单元）\n' +
      '要点：MAR 在取指后须重新装载为 R1 的内容（目的地址）；A 暂存是为了让 ALU 两端就绪；\n' +
      '写回用 MemW 且 MAR 保持不变。每节拍功能与有效控制信号一一对应，不得出现同节拍冲突的信号\n' +
      '（如同一节拍既读又写同一总线）。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: 'C5 取目的地址：MAR ← (R1)，控制信号 R1out、MARin', points: 2,
          evidenceHint: '答案含 MAR←(R1) 与 R1out/MARin',
          matchAny: ['R1out', 'MARin', 'MAR'],
        },
        {
          id: 'c2', description: 'C6 读主存操作数：MDR ← M(MAR)，控制信号 MemR、MDRinE', points: 2,
          evidenceHint: '答案含存储器读与 MDRinE',
          matchAny: ['MemR', 'MDRinE'],
        },
        {
          id: 'c3', description: 'C7 暂存被加数：A ← (R0)，控制信号 R0out、Ain', points: 2,
          evidenceHint: '答案含 R0out/Ain',
          matchAny: ['R0out', 'Ain'],
        },
        {
          id: 'c4', description: 'C8 ALU 相加：AC ← (A)+(MDR)，控制信号 MDRout、ADD、ACin', points: 2,
          evidenceHint: '答案含 ADD 与 ACin',
          matchAny: ['ADD', 'ACin', 'MDRout'],
        },
        {
          id: 'c5', description: 'C9 结果送 MDR：MDR ← (AC)，控制信号 ACout、MDRin', points: 2,
          evidenceHint: '答案含 ACout/MDRin',
          matchAny: ['ACout', 'MDRin'],
        },
        {
          id: 'c6', description: 'C10 写回主存：M(MAR) ← (MDR)，控制信号 MemW', points: 2,
          evidenceHint: '答案含 MemW',
          matchAny: ['MemW'],
        },
        {
          id: 'c7', description: '节拍顺序合理、无同节拍总线冲突，表格格式与题目一致', points: 1,
          evidenceHint: '答案按节拍表格列出且顺序为取数→运算→写回',
          matchAny: ['节拍', 'C5', '顺序'],
        },
      ],
    },
  },
  45: {
    analysis:
      '信号量设计（含义随定义给出）：\n' +
      'mutex = 1：缓冲区互斥信号量，保证任一时刻只有一个进程访问缓冲区；\n' +
      'empty = N：空单元数，约束放入前必须有空闲单元；\n' +
      'odd = 0：已放入的奇数个数，P2 的等待条件；\n' +
      'even = 0：已放入的偶数个数，P3 的等待条件。\n' +
      '三个进程的伪代码：\n' +
      'P1：while(true){ x = produce();              // 生成正整数\n' +
      '      P(empty); P(mutex); put(x); V(mutex);\n' +
      '      if (x % 2 == 1) V(odd); else V(even); }   // 按奇偶唤醒对应消费者\n' +
      'P2：while(true){ P(odd);  P(mutex); getodd();  V(mutex); V(empty); countodd();  }\n' +
      'P3：while(true){ P(even); P(mutex); geteven(); V(mutex); V(empty); counteven(); }\n' +
      '要点：P(empty)/V(empty) 必须分别配对在 P1 与 P2/P3 中；互斥 P(mutex) 在同步 P(odd)/P(even) 之后\n' +
      '（先申请资源再进临界区，避免持锁等待造成死锁）；取完后 V(empty) 归还空单元。\n' +
      '【各问分值为草稿拟定（本题合计 7 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 7,
      criteria: [
        {
          id: 'c1', description: '定义互斥信号量 mutex=1 并说明含义（缓冲区互斥）', points: 2,
          evidenceHint: '答案定义 mutex 且初值为 1',
          matchAny: ['mutex', '互斥', '=1'],
        },
        {
          id: 'c2', description: '定义同步信号量 empty=N、odd=0、even=0 并说明含义', points: 2,
          evidenceHint: '答案出现 empty/odd/even 三个信号量及含义说明',
          matchAny: ['empty', 'odd', 'even', '空单元'],
        },
        {
          id: 'c3', description: 'P1 伪代码正确：先 P(empty)、进临界区放数、按奇偶 V(odd)/V(even)', points: 2,
          evidenceHint: 'P1 含 produce、P(empty)、put 与奇偶分支',
          matchAny: ['produce', 'put', 'V(odd)', 'V(even)'],
        },
        {
          id: 'c4', description: 'P2/P3 伪代码正确：P(odd)/P(even) 先于 P(mutex)，取数后 V(mutex)、V(empty)', points: 1,
          evidenceHint: 'P2/P3 含 getodd/geteven 与 V(empty)',
          matchAny: ['getodd', 'geteven', 'V(empty)'],
        },
      ],
    },
  },
  46: {
    analysis:
      '【扁平化页表解码：页号 0 → 页框 101H、有效位 1；页号 1 → 有效位 0（不在内存）；页号 2 → 页框 254H、有效位 1。\n' +
      '页面大小 4KB，故虚地址高 12 位（十六进制前 3 位）为虚页号。】\n' +
      '(1) 依次访问三个虚地址：\n' +
      '· 2362H：虚页号 2。TLB 初始为空 → 访 TLB 10ns 未命中；查页表 100ns，页 2 有效位 1 → 页框 254H，\n' +
      '  访存取数 100ns。共 10 + 100 + 100 = 210ns（此访 TLB 未命中后回填 TLB，回填时间按题意忽略）。\n' +
      '· 1565H：虚页号 1。TLB 未命中 10ns；查页表 100ns，页 1 有效位 0 → 缺页中断，处理耗时 10⁸ ns\n' +
      '  （驻留集固定 2、LRU 局部淘汰：当前在内存的是页 0 与页 2，页 2 刚被访问，故淘汰页 0，\n' +
      '  页 1 装入页 0 原页框 101H；缺页处理已更新页表与 TLB）→ 返回重新执行该指令：\n' +
      '  TLB 命中 10ns + 访存 100ns。共 10 + 100 + 10⁸ + 10 + 100 = 10⁸ + 220 ns。\n' +
      '· 25A5H：虚页号 2。TLB 中已有页 2（2362H 访问后回填）→ TLB 命中 10ns + 访存 100ns = 110ns。\n' +
      '(2) 虚地址 1565H：页 1 缺页调入后占据页 0 被淘汰腾出的页框 101H，\n' +
      '  物理地址 = 页框号 101H 拼接页内偏移 565H = 101565H。理由：驻留集大小固定为 2 且采用 LRU 局部淘汰，\n' +
      '  访问序列中页 0 自初始装入后未被再次访问，是最久未使用页；页 2 在 2362H 访问中被使用，保留。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) 2362H 访问时间 210ns（TLB 未命中 10 + 查页表 100 + 访存 100）', points: 2,
          evidenceHint: '答案给出 210ns 或等价分项',
          matchAny: ['210', '100'],
        },
        {
          id: 'c2', description: '(1) 1565H 访问时间 10⁸+220ns（缺页处理 + 重新执行 TLB 命中）', points: 2,
          evidenceHint: '答案含 10^8 与 220（或分项 10+100+10+100）',
          matchAny: ['220', '10⁸', '10^8'],
        },
        {
          id: 'c3', description: '(1) 25A5H 访问时间 110ns（TLB 命中）', points: 1,
          evidenceHint: '答案给出 110ns',
          matchAny: ['110'],
        },
        {
          id: 'c4', description: '(2) 物理地址 101565H（页 1 调入页 0 淘汰后释放的页框 101H）', points: 2,
          evidenceHint: '答案给出 101565H',
          matchAny: ['101565', '101H'],
        },
        {
          id: 'c5', description: '(2) LRU 淘汰理由正确（页 0 最久未使用被淘汰、驻留集固定为 2）', points: 1,
          evidenceHint: '答案说明 LRU/局部淘汰与页 0 淘汰依据',
          matchAny: ['LRU', '最久未使用', '淘汰', '驻留集'],
        },
      ],
    },
  },
  47: {
    analysis:
      '【原题依赖网络拓扑图，扁平化题面保留了全部关键地址；图数据待核对】\n' +
      '(1) 子网划分：202.118.1.0/24 每个局域网至少 120 个地址 → 每子网主机位至少 7 位（2⁷−2=126 ≥ 120）。\n' +
      '划分两个 /25 子网：局域网 1 = 202.118.1.0/25（地址 202.118.1.1~202.118.1.126），\n' +
      '局域网 2 = 202.118.1.128/25（地址 202.118.1.129~202.118.1.254）。\n' +
      '(2) R1 的路由表（目的网络 | 子网掩码 | 下一跳 | 接口）：\n' +
      '· 202.118.1.0 / 255.255.255.128 | —（直连） | E1\n' +
      '· 202.118.1.128 / 255.255.255.128 | —（直连） | E2\n' +
      '· 202.118.3.2 / 255.255.255.255 | 202.118.2.2 | L0（域名服务器主机路由）\n' +
      '· 0.0.0.0 / 0.0.0.0 | 202.118.2.2 | L0（默认路由，去往互联网）\n' +
      '(3) R2 上的路由聚合：局域网 1、2 的两个 /25 恰好合并为 202.118.1.0/24，\n' +
      'R2 到两网的路由聚合为一条：202.118.1.0 / 255.255.255.0 | 下一跳 202.118.2.1 | 接口 L0。\n' +
      '【官方分值 9 分（v2）；官方子问拆分未知，v1 的 −4 分差从四个路由表条目采分点各减 1。】',
    rubric: {
      version: 2,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 两个 /25 子网划分正确（202.118.1.0/25 与 202.118.1.128/25）', points: 2,
          evidenceHint: '答案给出两个 /25 子网地址',
          matchAny: ['202.118.1.0/25', '202.118.1.128', '/25', '255.255.255.128'],
        },
        {
          id: 'c2', description: '(1) 理由/计算正确（主机位 7 位，2⁷−2=126 ≥ 120）', points: 2,
          evidenceHint: '答案说明 126 个可用地址满足 ≥120',
          matchAny: ['126', '120', '主机位'],
        },
        {
          id: 'c3', description: '(2) 到局域网 1、局域网 2 的直连路由正确（接口 E1/E2）', points: 2,
          evidenceHint: '路由表含两条直连路由及接口',
          matchAny: ['E1', 'E2', '直连'],
        },
        {
          id: 'c4', description: '(2) 域名服务器主机路由正确（202.118.3.2/32 经 202.118.2.2 走 L0）', points: 1,
          evidenceHint: '答案含 255.255.255.255 或 /32 主机路由',
          matchAny: ['255.255.255.255', '/32', '202.118.3.2'],
        },
        {
          id: 'c5', description: '(2) 默认路由正确（0.0.0.0/0 经 202.118.2.2 走 L0 指向互联网）', points: 1,
          evidenceHint: '答案给出默认路由 0.0.0.0/0',
          matchAny: ['0.0.0.0', '默认路由'],
        },
        {
          id: 'c6', description: '(3) 聚合路由 202.118.1.0/24、下一跳 202.118.2.1 正确', points: 1,
          evidenceHint: '答案给出聚合后的 /24 路由',
          matchAny: ['202.118.1.0/24', '255.255.255.0', '聚合'],
        },
      ],
    },
  },
};
