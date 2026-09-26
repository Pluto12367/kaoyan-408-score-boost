// V14-P0 R3 — 2023 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。解析自写原创。
// Q43/Q44 部分子问依赖图中数据（题面截断处标待核）；Q47 题干含源站图 XML 噪声，
// 问句已清理，数值推演标注待核。
export const draftsEssay = {
  41: {
    analysis:
      'K 顶点 = 出度 > 入度。邻接矩阵存储下：对每个顶点 i，出度 = 第 i 行元素之和，入度 = 第 i 列元素之和；\n' +
      '一次 O(n²) 双重循环同时累计每行/每列的和，再线性扫描比较 out[i]>in[i] 即可。\n' +
      '函数返回满足条件的顶点个数，边输出边计数。空间 O(1)（若不开辅助数组，用两个累加变量逐点比较）。' ,
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 设计思想：按行/列求出度、入度并比较', points: 4,
          evidenceHint: '答案说明出度=行和、入度=列和（或等价单/双循环方案）',
          matchAny: ['行', '列', '出度', '入度'],
        },
        {
          id: 'c2', description: '(2) 双重循环遍历邻接矩阵的实现正确', points: 4,
          evidenceHint: '代码含两层 for 与 Edge 矩阵累加',
          matchAny: ['Edge', 'for', '++'],
        },
        {
          id: 'c3', description: '(2) 出度>入度的判断与输出、计数正确', points: 3,
          evidenceHint: '代码含比较、printf/输出与计数返回',
          matchAny: ['printf', 'return', 'count', '>'],
        },
        {
          id: 'c4', description: '函数返回 K 顶点个数（含 0 的情形）', points: 2,
          evidenceHint: '答案说明返回值为个数',
          matchAny: ['个数', 'return'],
        },
      ],
    },
  },
  42: {
    analysis:
      '置换-选择排序：工作区容量 m，读入记录填充工作区，反复输出其中最小（且不小于刚输出值）的记录，\n' +
      '并从文件补入新记录；当工作区全部记录都小于刚输出值时当前归并段结束，开始新段。\n' +
      '(1) m=4 时对 19 个关键字逐步模拟：可生成 3 个初始归并段（具体分段按模拟过程，待教研按原卷核对分段清单）。\n' +
      '(2) 第一个初始归并段长度的极值：最长 = n（输入序列恰好整体有序递增时，一段收完所有记录）；\n' +
      '最短 = m（每次输出后新补入的记录都小于刚输出值，工作区清空一轮即断段，首段长度恰为 m）。',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) 模拟过程正确并给出归并段个数', points: 3,
          evidenceHint: '答案给出段数与依据',
          matchAny: ['归并段', '工作区', 'm=4'],
        },
        {
          id: 'c2', description: '(1) 各归并段的具体内容正确', points: 3,
          evidenceHint: '答案列出每段的有序关键字序列',
          matchAny: ['51', '94', '段'],
        },
        {
          id: 'c3', description: '(2) 最长段长度 = n 及条件说明', points: 2,
          evidenceHint: '答案给出 n 与「递增有序」条件',
          matchAny: ['n', '最长', '有序'],
        },
        {
          id: 'c4', description: '(2) 最短段长度 = m 及条件说明', points: 2,
          evidenceHint: '答案给出 m 与「补入记录均更小」条件',
          matchAny: ['m', '最短'],
        },
      ],
    },
  },
  43: {
    analysis:
      '数组 int a[24][64] 共 6144×4B = 24576B ≈ 24KB，起始 VA 0x00422000。\n' +
      '(1) 起始地址恰为页边界（低 12 位为 0）→ 占 24576/4096 = 6 页；顺序按行写访问 → 每页首次访问缺页一次，\n' +
      '共 6 次缺页；页故障地址 = 各页首个被访问元素的 VA（即 0x00422000、0x00423000、…、0x00427000，逐页递增）。\n' +
      '(2) 无时间局部性：每个元素只被访问一次（写 10），同一地址不会被再次访问；\n' +
      '但行优先遍历具有空间局部性。\n' +
      '(3)【题面截断，第 (3) 问 Cache 组号/缺失率的具体设问待原卷核对】\n' +
      'Cache 参数：8KB/32B/4 路 = 64 组 → 组号 5 位、块内 5 位；数组 32B 对齐良好，\n' +
      '每 8 个 int 占一块，首次访问缺失后同块 7 次命中。',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 页数 = 6 页', points: 2,
          evidenceHint: '答案给出 6 页（24576B/4096B）',
          matchAny: ['6', '页'],
        },
        {
          id: 'c2', description: '(1) 缺页 6 次，页故障地址为各页首元素的 VA', points: 4,
          evidenceHint: '答案给出 6 次缺页及地址序列',
          matchAny: ['缺页', '0042', '故障'],
        },
        {
          id: 'c3', description: '(2) 无时间局部性 + 理由（每元素仅访问一次）；指出空间局部性', points: 3,
          evidenceHint: '答案区分两种局部性',
          matchAny: ['时间局部性', '空间局部性', '一次'],
        },
        {
          id: 'c4', description: '(3) Cache 组号/命中率按 64 组口径计算（框架）', points: 4,
          evidenceHint: '答案按 64 组、块内 5 位等参数推演',
          matchAny: ['64', '组', '命中率', '缺失'],
        },
      ],
    },
  },
  44: {
    analysis:
      '【原题依赖完整机器级代码表（题面截断于第 3 行），数据待核对】\n' +
      '可读部分：指令 1 mov[ebp-8],0（i=0，i 在栈中 ebp−8）、指令 3 mov eax,[ebp-8]（读 i 至 eax）、\n' +
      '指令 7 jge 004010bch（i<24 循环条件跳转）。\n' +
      '(1) 相对寻址：jge 的目标地址 = 下一条指令地址 + 符号扩展的位移量，\n' +
      '可推得跳转位移 = 0x004010bc − (0x00401088+2) = 0x32 ✓（与机器码 7D 32 一致，可作讲解样例）。\n' +
      '(2) 数组 a 的地址、EBP 偏移、小端机器数：按完整代码表与存储器内容图核对（待核对）。\n' +
      '(3) 取指缺页：若指令所在页不在主存，取指阶段触发缺页异常（题给虚拟地址落在页表中未装入的页）。',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '相对寻址目标地址的计算方法正确（下一条指令地址+位移）', points: 3,
          evidenceHint: '答案给出 0x32 位移或等价计算',
          matchAny: ['004010bc', '32', '位移', '相对'],
        },
        {
          id: 'c2', description: '机器码与汇编指令的对应关系解读正确（mov/jge）', points: 2,
          evidenceHint: '答案解读 C7 45 F8 / EB 09 / 7D 32',
          matchAny: ['C7', 'EB', '7D', 'mov', 'jmp', 'jge'],
        },
        {
          id: 'c3', description: '数组 a 的地址/EBP 偏移分析正确（按图核对）', points: 2,
          evidenceHint: '答案给出 a[i] 的寻址表达式',
          matchAny: ['ebp', 'eax', '数组'],
        },
        {
          id: 'c4', description: '取指缺页异常的判断与处理说明', points: 3,
          evidenceHint: '答案说明取指阶段可触发缺页及其处理',
          matchAny: ['缺页', '异常', '取指'],
        },
      ],
    },
  },
  45: {
    analysis:
      '题 45(a) 伪代码（进入区用 swap(key, lock) 试图互斥）：\n' +
      '(1) 存在错误的语句：①「if (key == TRUE)」——swap 之后 key 恒为 FALSE（lock 的旧值），\n' +
      '该判断逻辑颠倒，应改为「if (key == FALSE) 进入临界区」；②进入区缺少循环（while）：\n' +
      '单次 swap 失败后没有重试，无法保证互斥，应改为 while(key==TRUE) swap(key, lock)（不增加语句条数的改法是把\n' +
      'if 换成 while）。退出区 lock=FALSE 正确。\n' +
      '(2) 不能用 newSwap(&key,&lock) 代替 swap 指令：newSwap 是普通函数，其三条赋值语句之间\n' +
      '可被中断/调度打断，两个线程同时执行时可能都读到 lock=FALSE 而双双进入临界区——\n' +
      'swap 指令的原子性（一条指令完成交换）是互斥成立的必要条件。',
    rubric: {
      version: 1,
      totalPoints: 7,
      criteria: [
        {
          id: 'c1', description: '(1) 指出 if 判断错误并给出正确条件', points: 2,
          evidenceHint: '答案指出 key/lock 值交换后的判断颠倒',
          matchAny: ['key', 'lock', 'TRUE', 'FALSE'],
        },
        {
          id: 'c2', description: '(1) 指出缺少重试（应 while 循环 swap）且不增加语句条数', points: 2,
          evidenceHint: '答案说明单次 swap 不能保证互斥',
          matchAny: ['while', '循环', '重试'],
        },
        {
          id: 'c3', description: '(2) 结论：不能替代', points: 1,
          evidenceHint: '答案明确「不能」',
          matchAny: ['不能', '无法'],
        },
        {
          id: 'c4', description: '(2) 理由：函数调用非原子，语句间可被打断导致双进', points: 2,
          evidenceHint: '答案说明原子性缺失与并发后果',
          matchAny: ['原子', '打断', '同时'],
        },
      ],
    },
  },
  46: {
    analysis:
      '键盘输入全流程（操作 ①~⑥：①P 入就绪队列；②P 入阻塞队列；③字符从控制器读入系统缓冲区；\n' +
      '④启动键盘中断处理程序；⑤P 从系统调用返回；⑥用户按键）：\n' +
      '(1) 正确顺序：P 调用系统调用请求输入 → ②（P 入阻塞队列）→ ⑥（用户输入）→ ④（启动中断处理程序）\n' +
      '→ ③（读入缓冲区）→ ①（P 入就绪队列）→ ⑤（P 返回）。故 ① 的前一个操作是 ③、后一个是 ⑤；\n' +
      '⑥ 的后一个操作是 ④。\n' +
      '(2) 在 ② 之后 CPU 一定切换到其他进程（P 已阻塞）；在 ① 之后调度程序才可能选择 P 执行。\n' +
      '(3) 操作 ③（从键盘控制器读字符入缓冲区）属于键盘驱动程序。\n' +
      '(4) 中断处理程序执行时：P 处于就绪态，CPU 处于内核态。',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) ① 的前一个操作为 ③、后一个为 ⑤', points: 2,
          evidenceHint: '答案给出正确的前后操作编号',
          matchAny: ['③', '⑤', '3', '5'],
        },
        {
          id: 'c2', description: '(1) ⑥ 的后一个操作为 ④', points: 1,
          evidenceHint: '答案给出按键触发中断处理',
          matchAny: ['④', '4', '中断'],
        },
        {
          id: 'c3', description: '(2) ② 后切换进程、① 后才可能调度 P', points: 2,
          evidenceHint: '答案区分阻塞后切换与就绪后可调度',
          matchAny: ['②', '①', '阻塞', '就绪'],
        },
        {
          id: 'c4', description: '(3) 操作 ③ 属于键盘驱动程序', points: 1,
          evidenceHint: '答案指出读控制器数据入缓冲为驱动层',
          matchAny: ['③', '3', '驱动'],
        },
        {
          id: 'c5', description: '(4) P 处于就绪态、CPU 处于内核态', points: 2,
          evidenceHint: '答案同时给出两个状态',
          matchAny: ['就绪', '内核态'],
        },
      ],
    },
  },
  47: {
    analysis:
      '【原题依赖拓扑图，题干问句已从图 XML 噪声中清理，数值推演待核对】\n' +
      '已知：F=18000B（18 个 MSS 段），初始序号 100，MSS=1000B，阈值 4MSS，RTT=10ms，无丢包。\n' +
      '(1) FTP 控制连接持久（整个会话保持）、数据连接非持久（每传一个文件建一次）；H 登录建立的是控制连接。\n' +
      '(2) 数据连接：SYN 占一个序号 → 首字节序号 = 101；断开时最后数据字节序号 = 101+18000−1 = 18100，\n' +
      'FIN 序号 18101，第二次挥手的 ACK 序号 = 18102。\n' +
      '(3) 慢启动：cwnd 1→2→4MSS（到阈值），收到 ack=2101（确认 2 段）时 cwnd=2MSS;\n' +
      '收到 ack=7101（累计确认 7 段，已过阈值）→ 拥塞避免阶段 cwnd=4+3=7MSS？推演口径按原卷答案核对。\n' +
      '(4) 总时间 = 慢启动+拥塞避免阶段各 RTT 累加（18 段发完并确认），平均速率 = 18000B/总时间。\n' +
      '【(3)(4) 的具体窗口/时间数值待按原卷推演口径核对。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 控制连接持久、数据连接非持久；登录建立控制连接', points: 3,
          evidenceHint: '答案区分两种连接的持久性',
          matchAny: ['控制连接', '数据连接', '持久'],
        },
        {
          id: 'c2', description: '(2) 首字节序号 = 101', points: 1,
          evidenceHint: '答案给出 101',
          matchAny: ['101'],
        },
        {
          id: 'c3', description: '(2) 第二次挥手 ACK 序号 = 18102', points: 2,
          evidenceHint: '答案给出 18102 或等价推导',
          matchAny: ['18102', 'ACK'],
        },
        {
          id: 'c4', description: '(3) 两个确认时刻的拥塞窗口调整正确', points: 2,
          evidenceHint: '答案给出慢启动/拥塞避免的窗口值',
          matchAny: ['拥塞窗口', '慢启动', 'MSS'],
        },
        {
          id: 'c5', description: '(4) 总时间与应用层平均发送速率', points: 1,
          evidenceHint: '答案给出时间与速率',
          matchAny: ['速率', '时间', 'RTT'],
        },
      ],
    },
  },
};
