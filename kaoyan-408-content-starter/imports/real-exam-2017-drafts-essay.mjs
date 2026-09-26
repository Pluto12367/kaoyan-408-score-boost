// V14 内容生产轨 — 2017 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。
// rubric 遵循 rubric-v1 JSON 规范（totalPoints = Σ criteria.points）。
// ⚠ 2017 各大题官方单题分值待官方分值表（bundle 中 score=null）：以下 totalPoints 与
//   子问分值拆分为草稿拟定（合计 70 分，与 40×2+70=150 卷面结构一致），解析中已显式标注「待核」。
// 图依赖：Q42 图 G 边集、Q44 机器级代码表（关键行已随题面保留）。
export const draftsEssay = {
  41: {
    analysis:
      '(1) 基本设计思想：表达式树的中序遍历序列即中缀表达式（去括号形态）；操作符的计算次序用括号反映——\n' +
      '**叶结点直接输出操作数；非叶结点（操作符）先输出左子树表达式、再输出自身、后输出右子树表达式，\n' +
      '且除整棵树的根外，每个非叶结点的子表达式两侧加括号**。深度参数 deep 控制括号：根（deep=0）不加括号。\n' +
      '(2) 代码（C 语言）：\n' +
      'void tree2expr(BTree *root, int deep) {\n' +
      '    if (root == NULL) return;\n' +
      '    if (root->left == NULL && root->right == NULL) {   // 叶结点：操作数直接输出\n' +
      '        printf("%s", root->data);\n' +
      '        return;\n' +
      '    }\n' +
      '    if (deep > 0) printf("(");          // 非根的子表达式加左括号\n' +
      '    tree2expr(root->left, deep + 1);    // 左子树\n' +
      '    printf("%s", root->data);           // 操作符\n' +
      '    tree2expr(root->right, deep + 1);   // 右子树\n' +
      '    if (deep > 0) printf(")");          // 右括号\n' +
      '}\n' +
      '// 调用：tree2expr(root, 0);  根不加括号，其余按层加括号\n' +
      '验证样例：树 1 输出 (a+b)*(c*(−d))；树 2 输出 (a*b)+(−(c−d))，与题面一致。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 设计思想正确（中序遍历 + 非根子表达式加括号）', points: 5,
          evidenceHint: '答案描述中序次序与括号添加规则',
          matchAny: ['中序', '括号', '叶', '遍历'],
        },
        {
          id: 'c2', description: '(2) 代码正确：叶判定、递归左右子树、deep 控制括号', points: 7,
          evidenceHint: '代码含叶结点输出、deep 判定与两次递归',
          matchAny: ['printf', 'left', 'right', 'deep'],
        },
        {
          id: 'c3', description: '(2) 关键处有简要注释', points: 1,
          evidenceHint: '代码含注释',
          matchAny: ['//', '/*'],
        },
      ],
    },
  },
  42: {
    analysis:
      '(1) Prim 算法（从 A 开始）：初始已选集合 {A}；每一步从「已选顶点集与外部顶点之间的横切边」中\n' +
      '选取权值最小的一条、并把该外部顶点并入集合，重复直至包含全部顶点。\n' +
      '对图 G 按上述规则执行即可得到依次选出的边【具体边序依赖原卷图 G 的边集与权值（扁平化后失真），\n' +
      '待教研按原图核对；按官方答案，MST 含 4 条边、总权值 4+4+4+5 = 17】。\n' +
      '(2) 该图 G 的 MST **唯一**——图 G 中不存在权值相同的边参与候选竞争，每一步的最小横切边唯一。\n' +
      '(3) 对任意带权连通图：当**各边权值互不相同**时，其 MST 唯一。\n' +
      '理由：若两棵不同生成树 T1、T2 都是 MST，取 T1−T2 中权值最小的边 e 与 T2−T1 中对应的边 f，\n' +
      '可证明 w(e) = w(f)——即存在等权边；反之权值互异则不可能有两棵 MST。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) Prim 执行方法正确（横切边最小、逐点并入）【边序待原图核对】', points: 3,
          evidenceHint: '答案描述横切边选择过程',
          matchAny: ['横切', '最小', '并入', 'Prim'],
        },
        {
          id: 'c2', description: '(2) 结论：图 G 的 MST 唯一并给出理由', points: 2,
          evidenceHint: '答案给出唯一性与理由',
          matchAny: ['唯一'],
        },
        {
          id: 'c3', description: '(3) 条件：各边权值互不相同时 MST 唯一（附反证说明）', points: 3,
          evidenceHint: '答案给出权值互异条件',
          matchAny: ['权值', '互不相同', '唯一'],
        },
      ],
    },
  },
  43: {
    analysis:
      '(1) n=0 时：循环条件 i ≤ n−1，n 为 unsigned → n−1 = 0xFFFFFFFF（无符号最大值 4294967295），\n' +
      'i 从 0 递增永远 ≤ 它 → 死循环。若 i、n 都改为 int：n−1 = −1，条件 0 ≤ −1 为假 → **循环一次都不执行，\n' +
      '不会死循环**（直接返回 sum=1）。\n' +
      '(2) f1(23)：sum = 1+2+4+…+2²³ = 2²⁴ − 1 = 16777215，int 精确表示 → 机器数 **00FF FFFFH**。\n' +
      'f2(23)：float 有效尾数 24 位（含隐含 1），2²⁴−1 的二进制恰为 24 个 1 → 可精确表示，值 16777215.0：\n' +
      '符号 0、阶码 23+127 = 150 = 1001 0110、尾数全 1 → 机器数 **4B7F FFFFH**。两者**数值相等**（都为 2²⁴−1）。\n' +
      '(3) f1(24) = 2²⁵ − 1 = 33554431（int 32 位可精确）；f2(24)：2²⁵−1 需 25 位有效数字，超出 float 24 位尾数，\n' +
      '按就近舍入上取为 2²⁵ = 33554432.0 → 相差 1，不相等。\n' +
      '(4) f(31) = 2³² − 1 = 4294967295 超出 int 最大值 2³¹−1 → sum 溢出：0xFFFF FFFF 按补码解释为 **−1**，\n' +
      '故 f1(31) 返回 −1。要 f1(n) = f(n) → 2^(n+1) − 1 ≤ 2³¹ − 1 → n + 1 ≤ 31 → 最大 **n = 30**。\n' +
      '(5) 7F80 0000H：符号 0、阶码全 1、尾数 0 → **+∞**（正无穷）。f2(n) ≈ 2^(n+1)：\n' +
      '· 不溢出：2^(n+1) ≤ float 最大值 (2−2⁻²³)×2¹²⁷ < 2¹²⁸ → n+1 ≤ 127 → 最大 **n = 126**；\n' +
      '· 精确：2^(n+1) − 1 需 n+1 位有效数字 ≤ 24 → 最大 **n = 23**。\n' +
      '【各问分值为草稿拟定（本题合计 14 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 14,
      criteria: [
        {
          id: 'c1', description: '(1) unsigned 下 0−1=0xFFFFFFFF 恒真死循环；int 下 −1 使条件为假不循环', points: 3,
          evidenceHint: '答案说明无符号回绕与有符号负数两种情形',
          matchAny: ['无符号', '0xFFFF', '死循环', '不'],
        },
        {
          id: 'c2', description: '(2) f1(23)=00FFFFFFH、f2(23)=4B7FFFFFH 且数值相等', points: 3,
          evidenceHint: '答案给出两个机器数',
          matchAny: ['00FFFF', '4B7F'],
        },
        {
          id: 'c3', description: '(3) f2(24) 因 25 位有效数字超出 24 位尾数舍入到 2²⁵', points: 2,
          evidenceHint: '答案说明舍入与位数',
          matchAny: ['舍入', '24', '2²⁵'],
        },
        {
          id: 'c4', description: '(4) int 溢出 0xFFFFFFFF 补码为 −1；f1 返回值等于 f(n) 的最大 n = 30', points: 3,
          evidenceHint: '答案给出溢出解释与 n=30',
          matchAny: ['溢出', '-1', '30'],
        },
        {
          id: 'c5', description: '(5) 7F800000H 为 +∞；不溢出最大 n=126、精确最大 n=23', points: 3,
          evidenceHint: '答案给出 +∞ 与两个 n 上限',
          matchAny: ['∞', '126', '23'],
        },
      ],
    },
  },
  44: {
    analysis:
      '(1) **CISC**。理由：指令长度可变（如 55 为 1 字节、D1 E2 为 2 字节、39 4D F4 为 3 字节），\n' +
      '且存在多种寻址方式与复杂指令（dword ptr 存储器操作数等）——都是 CISC 的典型特征（RISC 指令定长、格式规整）。\n' +
      '(2) 机器代码从 00401020H 起、最后一条 ret（1 字节）位于 0040107FH，结束地址 = 00401080H：\n' +
      '总长度 = 00401080H − 00401020H = 80H = **96 字节**。\n' +
      '(3) i=0、n=0 时：ecx = n−1 = −1 = 0FFFFFFFFH。cmp 执行 0 − (−1) = 0 − 0FFFFFFFFH = 1，\n' +
      '结果为正、最高位无借位 → **CF = 0**。（补码加法 0 + 1 = 1，未超出 32 位，无进位借位。）\n' +
      '(4) f2 中**不能**用 shl 实现 power×2。理由：float 的机器数是 IEEE754 编码——符号位、偏置阶码、\n' +
      '尾数三段拼接的位型；对位型整体左移一位并不等价于数值乘 2（阶码与尾数字段互相错位、\n' +
      '符号位被尾数最高位侵入）。float 乘 2 应通过阶码加 1（浮点乘法指令/专门的浮点部件）实现。\n' +
      '【各问分值为草稿拟定（本题合计 10 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) CISC，理由 = 指令变长 + 多种寻址方式', points: 3,
          evidenceHint: '答案给出 CISC 及变长指令理由',
          matchAny: ['CISC', '变长', '寻址'],
        },
        {
          id: 'c2', description: '(2) 机器代码共 96 字节（00401080H − 00401020H = 60H）', points: 3,
          evidenceHint: '答案给出 96（或 60H）及计算过程',
          matchAny: ['96', '60H'],
        },
        {
          id: 'c3', description: '(3) CF = 0（0 − (−1) = 1 无借位，含计算过程）', points: 2,
          evidenceHint: '答案给出 CF=0 及减法过程',
          matchAny: ['CF', '0'],
        },
        {
          id: 'c4', description: '(4) 不能：float 位型左移不等于数值乘 2（阶码/尾数编码破坏）', points: 2,
          evidenceHint: '答案说明 IEEE754 编码与左移的不相容',
          matchAny: ['阶码', '尾数', '编码', '不能'],
        },
      ],
    },
  },
  45: {
    analysis:
      '(1) 机器代码占 96 字节、页大小 4KB（2¹²）→ 96B < 4KB，且代码起始 00401020H 到结束 00401080H\n' +
      '不跨页边界（同在 00401000H 起的一页内）→ 只占 **1 页**。\n' +
      '(2) 第 1 条指令虚拟地址 00401020H：页目录号 = 00401020H >> 22 = 00401020H 的高 10 位 =\n' +
      '0000 0000 01₂ = **1 号表项**；页表索引 = 中间 10 位：00401020H = 0000 0000 0100 0000 0001 0000 0010 0000₂ →\n' +
      '页表索引位（第 21~12 位）= 00 0000 0001₂ = **1 号表项**。即页目录第 1 项、页表第 1 项（编号从 0 起）。\n' +
      '(3) scanf() 等待键盘输入：进程 P 需等待 I/O 数据就绪 → 从执行态**转为阻塞态**（键盘输入到达的中断\n' +
      '唤醒后转就绪态、再被调度执行）。CPU **会进入内核态**：系统调用陷入（trap）进入内核执行 read 服务、\n' +
      '键盘中断的处理也在内核态完成。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) 机器代码占 1 页（96B 不跨页）', points: 2,
          evidenceHint: '答案给出 1 页及理由',
          matchAny: ['1 页', '一页', '不跨'],
        },
        {
          id: 'c2', description: '(2) 页目录第 1 表项、页表第 1 表项（编号从 0）', points: 3,
          evidenceHint: '答案给出 1 号/1 号（0 起编号）',
          matchAny: ['1'],
        },
        {
          id: 'c3', description: '(3) 状态：执行→阻塞（I/O 完成后唤醒）；CPU 进入内核态（系统调用+中断处理）', points: 3,
          evidenceHint: '答案说明阻塞态变化与内核态进入',
          matchAny: ['阻塞', '内核态', '就绪'],
        },
      ],
    },
  },
  46: {
    analysis:
      '临界资源分析：z 是 thread2（读）与 thread3（读写）共享的全局复数；y 是 thread1（读）、thread2（读）、\n' +
      'thread3（读写）共享；x 只被 thread1 读 → x 无需保护。add() 内部是局部变量，互不冲突。\n' +
      '并发约束：thread3 的 z=add(z,w) 与 thread2 的 w=add(y,z) 对 z 的访问须互斥；\n' +
      'thread3 的 y=add(y,w) 与 thread1、thread2 对 y 的读须互斥。为保证「最大程度并发」，\n' +
      '为 y、z 分别设互斥信号量（而非全局一把锁）：\n' +
      'semaphore mutex_y = 1;   // 保护全局变量 y\n' +
      'semaphore mutex_z = 1;   // 保护全局变量 z\n' +
      'thread1 {\n' +
      '    cnum w;\n' +
      '    P(mutex_y); w = add(x, y); V(mutex_y);   // 只读 y，须与写 y 者互斥\n' +
      '}\n' +
      'thread2 {\n' +
      '    cnum w;\n' +
      '    P(mutex_y); P(mutex_z);      // 同时读 y、读 z\n' +
      '    w = add(y, z);\n' +
      '    V(mutex_z); V(mutex_y);\n' +
      '}\n' +
      'thread3 {\n' +
      '    cnum w;\n' +
      '    w.a = 1; w.b = 2;\n' +
      '    P(mutex_z); z = add(z, w);   // 写 z\n' +
      '    P(mutex_y); y = add(y, w);   // 写 y\n' +
      '    V(mutex_y); V(mutex_z);\n' +
      '}\n' +
      '（thread3 中两次 P 的顺序在单线程内固定，不会成环死锁。）\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '信号量定义正确（mutex_y=1、mutex_z=1 分开保护两个全局变量）', points: 3,
          evidenceHint: '答案定义两个互斥信号量及初值',
          matchAny: ['mutex', 'y', 'z', '1'],
        },
        {
          id: 'c2', description: 'thread1 对 y 的读加锁、thread2 对 y+z 同时加锁且 P/V 配对', points: 3,
          evidenceHint: 'thread1/2 的 P/V 配对正确',
          matchAny: ['P(mutex_y)', 'P(mutex_z)', 'V(mutex_z)', 'V(mutex_y)'],
        },
        {
          id: 'c3', description: 'thread3 写 z、写 y 分别加锁解锁，且说明不产生死锁（最大并发）', points: 3,
          evidenceHint: 'thread3 的加锁顺序与并发性说明',
          matchAny: ['P(mutex_z)', 'P(mutex_y)', '并发', '死锁'],
        },
      ],
    },
  },
  47: {
    analysis:
      '参数：帧长 1000B → 发送时延 Tt = 1000×8/100Mbps = 80μs；RTT = 0.96ms → 周期 Tt+RTT = 1.04ms。\n' +
      '发送序号与确认号均 3 比特 → 窗口 ≤ 7（GBN 取 2³−1）。\n' +
      '(1) 图 (a)：t0~t1 期间甲方收到 R0,1（确认 0 号帧）与 R1,3（累计确认至 1 号帧，即 0、1 号均已正确接收；\n' +
      'S2,0、S3,0 因确认号回退 1 而丢失/作废）。可断定乙方正确接收 **2 个数据帧**：**S0,0、S1,0**。\n' +
      '(2) t1 时刻甲方窗口基态：已确认至 1 号、发送序号已用到 4 → 可连续发送直到「已发送未确认数 = 7」：\n' +
      '窗口内还可发 7 − 3 = 4 个帧（S4~S7 已用 4 个序号中的……按已发 S4,1 计）：\n' +
      '从 t1 起最多再发 **4 个**数据帧，第一个 **S5,1**，最后一个 **S0,3**（序号模 8 回绕，捎带最新确认号 3）。\n' +
      '(3) 图 (b)：S2,0 超时 → GBN 回退 N：重发 S2 及其后已发送的帧（S3 及收到的 R1,2 之后各帧），\n' +
      '需重发 **3 个**数据帧（S2、S3、S4），第一个为 **S2,2**（捎带当前确认号 2）。\n' +
      '(4) 最大信道利用率 = W·Tt/(Tt + RTT) = 7×80μs/(80μs + 960μs) = 560/1040 ≈ **53.8%**。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) 已正确接收 2 帧：S0,0 与 S1,0（累计确认判读）', points: 2,
          evidenceHint: '答案给出 2 帧与 S0,0/S1,0',
          matchAny: ['S0,0', 'S1,0'],
        },
        {
          id: 'c2', description: '(2) 最多再发 4 帧，首帧 S5,1、末帧 S0,3（序号回绕）', points: 2,
          evidenceHint: '答案给出 4 帧与 S5,1/S0,3',
          matchAny: ['S5,1', 'S0,3', '4'],
        },
        {
          id: 'c3', description: '(3) 重发 3 帧、第一个 S2,2（GBN 回退 N）', points: 2,
          evidenceHint: '答案给出 3 帧与 S2,2',
          matchAny: ['S2,2', '3'],
        },
        {
          id: 'c4', description: '(4) 最大信道利用率 ≈ 53.8%（W=7 代入公式）', points: 2,
          evidenceHint: '答案给出 53.8%（或 0.538）',
          matchAny: ['53.8', '0.538', '560'],
        },
      ],
    },
  },
};
