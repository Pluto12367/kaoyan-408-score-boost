// V14 内容生产轨 — 2015 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。
// rubric 遵循 rubric-v1 JSON 规范（totalPoints = Σ criteria.points）。
// ⚠ 2015 各大题官方单题分值待官方分值表（bundle 中 score=null）：以下 totalPoints 与
//   子问分值拆分为草稿拟定（合计 70 分，与 40×2+70=150 卷面结构一致），解析中已显式标注「待核」。
// 图依赖：Q42 邻接关系、Q43 数据通路图端点编号、Q47 拓扑地址标注——相应小问按方法作答并标注待核。
export const draftsEssay = {
  41: {
    analysis:
      '(1) 基本设计思想：以空间换时间。|data| ≤ n → 设辅助标记数组 flag[n+1]（初值全 0），\n' +
      '从链表头扫描：对每个结点取 |data|，若 flag[|data|]==0 则保留该结点并置 flag[|data|]=1；\n' +
      '若已为 1（该绝对值出现过）则删除当前结点（前驱指针跨接）。单趟扫描完成。\n' +
      '(2) 结点类型定义（C 语言）：\n' +
      'typedef struct node {\n' +
      '    int data;                 // 结点数据，|data| ≤ n\n' +
      '    struct node *next;\n' +
      '} Node;\n' +
      '(3) 算法（C 语言）：\n' +
      'void dedupAbs(Node *head) {\n' +
      '    int *flag = calloc(n + 1, sizeof(int));   // 标记数组，初值 0\n' +
      '    Node *pre = head, *p = head->next;        // 带头结点，p 指向第一个数据结点\n' +
      '    while (p != NULL) {\n' +
      '        int a = abs(p->data);                 // 取绝对值\n' +
      '        if (flag[a] == 0) { flag[a] = 1; pre = p; p = p->next; }   // 首次出现：保留\n' +
      '        else { pre->next = p->next; free(p); p = pre->next; }      // 重复：摘除释放\n' +
      '    }\n' +
      '    free(flag);\n' +
      '}\n' +
      '(4) 时间复杂度 O(m)（单趟扫描，每结点常数工作），空间复杂度 O(n)（标记数组）。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 设计思想正确（辅助标记数组按绝对值去重、只留首现结点）', points: 4,
          evidenceHint: '答案描述标记数组与首现保留策略',
          matchAny: ['标记', '数组', '绝对值', '首次'],
        },
        {
          id: 'c2', description: '(2) 结点类型定义正确（data + next）', points: 2,
          evidenceHint: '定义含 data 与 next',
          matchAny: ['struct', 'data', 'next'],
        },
        {
          id: 'c3', description: '(3) 代码正确：标记数组使用、首次保留/重复删除、链表摘接正确', points: 5,
          evidenceHint: '代码含标记判断与 pre->next 跨接删除',
          matchAny: ['flag', 'abs', 'pre', 'next'],
        },
        {
          id: 'c4', description: '(3) 关键处有简要注释', points: 1,
          evidenceHint: '代码含注释',
          matchAny: ['//', '/*'],
        },
        {
          id: 'c5', description: '(4) 时间 O(m)、空间 O(n)', points: 1,
          evidenceHint: '答案给出两个复杂度',
          matchAny: ['O(m)', 'O(n)'],
        },
      ],
    },
  },
  42: {
    analysis:
      '【原题依赖 5 顶点带权/无权图 G 的图形，扁平化题面仅保留顶点编号 0~4，邻接关系待教研按原图核对；\n' +
      '以下按方法作答，矩阵数值须对照原图填写】\n' +
      '(1) 邻接矩阵 A：A[i][j] = 1 当且仅当存在边 <vi,vj> 或 (vi,vj)（无向图对称 A[i][j]=A[j][i]；\n' +
      '有向图按方向取值；自己到自身为 0）。按图中边集逐行填写 5×5 矩阵。\n' +
      '(2) A² = A×A（普通矩阵乘法）。A²[0][3] = Σ(A[0][k]·A[k][3])，其含义：**从顶点 0 到顶点 3、\n' +
      '经过恰好 2 条边（长度为 2）的路径数目**。数值按原图边集计算。\n' +
      '(3) B^m（2≤m≤n）中非零元素 B^m[i][j] ≠ 0 的含义：**顶点 i 到顶点 j 之间存在长度恰好为 m 的路径**\n' +
      '（B^m[i][j] 的数值即为长度为 m 的不同路径条数；非零 ⇔ 可达且步数为 m）。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 邻接矩阵按原图边集填写正确（对称性/方向正确）', points: 4,
          evidenceHint: '答案给出 5×5 矩阵【数值依赖原图，待核】',
          matchAny: ['邻接矩阵', 'A'],
        },
        {
          id: 'c2', description: '(2) A² 按 A×A 计算正确【数值依赖原图，待核】', points: 3,
          evidenceHint: '答案给出 A² 矩阵',
          matchAny: ['A²', 'A^2', '矩阵乘'],
        },
        {
          id: 'c3', description: '(2) A²[0][3] 含义 = 顶点 0 到 3 长度为 2 的路径条数', points: 3,
          evidenceHint: '答案说明 2 条边路径数的含义',
          matchAny: ['路径', '2 条', '长度为 2'],
        },
        {
          id: 'c4', description: '(3) B^m 非零元素含义 = i 到 j 存在长度为 m 的路径', points: 3,
          evidenceHint: '答案给出长度为 m 的路径可达含义',
          matchAny: ['长度', 'm', '路径', '可达'],
        },
      ],
    },
  },
  43: {
    analysis:
      '(1) 程序员可见寄存器：**通用寄存器 R0~R3 与 PC**（汇编指令可直接引用；转移指令改变 PC）。\n' +
      'IR、MAR、MDR、暂存器 T、移位寄存器 SR 均不可见。设置暂存器 T 的原因：**单总线结构下 ALU 只有一个\n' +
      '总线输入口**，双操作数运算须先把第一个操作数暂存到 T，再从总线取第二个操作数同时送 ALU 的另一输入端，\n' +
      '两个输入才能就绪（同时防止总线上后到的数据覆盖先到的操作数）。\n' +
      '(2) ALUop 控制 7 种操作 → 至少 ⌈log₂7⌉ = **3 位**；SRop 控制 3 种操作 → 至少 **2 位**。\n' +
      '(3) SRout 控制的是**移位寄存器 SR 的输出三态门**：有效时把 SR 的内容（移位结果）送到 CPU 内总线。\n' +
      '(4)【依赖数据通路图端点位置，待教研按原图核对】判别方法：凡传输**控制信号**的端点\n' +
      '（寄存器 Xin/Xout 使能、Tin、MEMop、MUXop、ALUop、SRop、SRout 等）都须接控制部件输出端；\n' +
      '传输数据的端点不接。按图 a 用到的信号，图中标注上述信号名称的端点即答案。\n' +
      '(5)【依赖图，待核】方法：补线使数据流「寄存器/MDR ↔ 内总线 ↔ ALU/SR」闭合：例如 MDR 与内总线之间、\n' +
      '内总线与 ALU 输入端 B 之间等按数据流向连接（起点=数据发出方，终点=数据接收方）。\n' +
      '(6) MUX 一个输入端是 2：取指后 PC 需**加 2** 指向下一条指令（指令字长 16 位 = 2 字节，按字节编址），\n' +
      'MUX 选择常数 2 与 PC 一起送加法器完成 (PC)+2。\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 可见寄存器 = R0~R3 与 PC；暂存器 T 原因 = 单总线需暂存第一操作数', points: 3,
          evidenceHint: '答案给出可见寄存器与 T 的作用',
          matchAny: ['R0', 'PC', '暂存', '单总线'],
        },
        {
          id: 'c2', description: '(2) ALUop 至少 3 位、SRop 至少 2 位', points: 2,
          evidenceHint: '答案给出 3 位与 2 位',
          matchAny: ['3', '2'],
        },
        {
          id: 'c3', description: '(3) SRout = SR 输出三态门（控制 SR 到内总线的输出）', points: 1,
          evidenceHint: '答案说明输出门/送内总线',
          matchAny: ['三态', '输出', '内总线'],
        },
        {
          id: 'c4', description: '(5) 补线方向正确（数据从发出方流向接收方，经内总线闭合数据通路）【依赖图】', points: 1,
          evidenceHint: '答案给出起点终点式连线',
          matchAny: ['内总线', 'MDR', '连线'],
        },
        {
          id: 'c5', description: '(6) MUX 输入 2 = 指令字长 2 字节、PC+2 指向下条指令', points: 2,
          evidenceHint: '答案说明 PC+2 与字节编址',
          matchAny: ['2', 'PC', '指令字'],
        },
      ],
    },
  },
  44: {
    analysis:
      '(1) 三地址指令：OP 7 位 + Md,Rd + Ms1,Rs1 + Ms2,Rs2（各 3 位）= 16 位。指令系统最多可定义\n' +
      '**2⁷ = 128 条**指令（7 位操作码字段全部用于编码时取最大；二/单地址指令通过末 3/6 位为 0 的扩展方式\n' +
      '与三地址共用同一 7 位基本操作码空间）。\n' +
      '(2) 机器代码（OP=01H/02H/03H）：\n' +
      '· inc R1（单地址）：OP=0000001，Md=0，Rd=01，末 6 位 0 → 0000001 0 01 000000 = **0480H**；\n' +
      '· shl R2,R1（二地址）：OP=0000010，Md=0，Rd=10，Ms1=0，Rs1=01，末 3 位 000 → 0000010 0 10 0 01 000 = **0488H**；\n' +
      '· sub R3,(R1),R2（三地址）：OP=0000011，Md=0，Rd=11，Ms1=1（寄存器间接），Rs1=01，Ms2=0，Rs2=10\n' +
      '  → 0000011 0 11 1 01 0 10 = **06EAH**。\n' +
      '(3) 图 a 中标号：① = MUXop = 1（选择常数 2，实现 PC+2）；② = SRop = mov（直送）；③ = ALUop = mova（直送 A）；\n' +
      '④ = SRop = left（左移一位）；⑤ = MEMop = read；⑥ = ALUop = sub；⑦ = SRop = mov（直送）；⑧ = MDRout = 1。\n' +
      '(4) sub R1,R3,(R2) 执行阶段：送地址（R2out→MAR+读存储器）→ 取数入 T → ALU 减法经 SR → 写回 R1，\n' +
      '对照图 a 同型指令的 4 行控制信号 → 至少 **4 个时钟周期**；inc R1 执行：取数入 T → 加 1 经 SR → 写回 R1，\n' +
      '至少 **3 个时钟周期**。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 最多 128 条指令（OP 7 位）', points: 3,
          evidenceHint: '答案给出 128',
          matchAny: ['128'],
        },
        {
          id: 'c2', description: '(2) 机器码 0480H、0488H、06EAH 拼装正确', points: 4,
          evidenceHint: '答案给出三个十六进制机器码',
          matchAny: ['0480', '0488', '06EA'],
        },
        {
          id: 'c3', description: '(3) 标号①~⑧取值正确（1/mov/mova/left/read/sub/mov/MDRout）', points: 3,
          evidenceHint: '答案给出各标号的信号或取值',
          matchAny: ['mova', 'left', 'read', 'sub', 'MDRout'],
        },
        {
          id: 'c4', description: '(4) sub 至少 4 周期、inc 至少 3 周期', points: 3,
          evidenceHint: '答案给出 4 与 3',
          matchAny: ['4', '3'],
        },
      ],
    },
  },
  45: {
    analysis:
      '信号量设计（按信箱互为生产者-消费者）：\n' +
      'fullA = x：A 信箱中的邮件数；emptyA = M−x：A 信箱空位数；mutexA = 1：A 信箱互斥。\n' +
      'fullB = y：B 信箱中的邮件数；emptyB = N−y：B 信箱空位数；mutexB = 1：B 信箱互斥。\n' +
      '过程：\n' +
      'A {\n' +
      '    while (true) {\n' +
      '        P(fullA);  P(mutexA);      // A 信箱有邮件才能取\n' +
      '        从 A 的信箱中取出一个邮件;\n' +
      '        V(mutexA);\n' +
      '        回答问题并提出一个新问题;\n' +
      '        P(emptyB); P(mutexB);      // B 信箱有空位才能放\n' +
      '        将新邮件放入 B 的信箱;\n' +
      '        V(mutexB);  V(fullB);\n' +
      '    }\n' +
      '}\n' +
      'B {\n' +
      '    while (true) {\n' +
      '        P(fullB);  P(mutexB);\n' +
      '        从 B 的信箱中取出一个邮件;\n' +
      '        V(mutexB);\n' +
      '        回答问题并提出一个新问题;\n' +
      '        P(emptyA); P(mutexA);\n' +
      '        将新邮件放入 A 的信箱;\n' +
      '        V(mutexA);  V(fullA);\n' +
      '    }\n' +
      '}\n' +
      '要点：同步信号（full/empty）先于互斥信号（mutex）申请；V(fullB) 在放入完成之后执行；\n' +
      '初始 x、y 均大于 0 保证辩论可以开始。\n' +
      '【各问分值为草稿拟定（本题合计 7 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 7,
      criteria: [
        {
          id: 'c1', description: '信号量定义齐全并赋初值：fullA=x/emptyA=M−x/mutexA=1（B 侧对称）', points: 3,
          evidenceHint: '答案定义两类信箱的同步与互斥信号量',
          matchAny: ['full', 'empty', 'mutex', 'x', 'M'],
        },
        {
          id: 'c2', description: 'A 过程正确（取件 P(fullA)→互斥；放件 P(emptyB)→互斥→V(fullB)）', points: 2,
          evidenceHint: 'A 的 P/V 配对与顺序正确',
          matchAny: ['P(fullA)', 'P(emptyB)', 'V(fullB)'],
        },
        {
          id: 'c3', description: 'B 过程对称正确', points: 2,
          evidenceHint: 'B 的 P/V 与 A 对称',
          matchAny: ['P(fullB)', 'P(emptyA)', 'V(fullA)'],
        },
      ],
    },
  },
  46: {
    analysis:
      '(1) 页内偏移 12 位 → 页大小 = 页框大小 = 2¹² = **4KB**；虚拟地址 10+10+12 = 32 位 →\n' +
      '虚拟地址空间 = 2³² B，页数 = 2²⁰ = **1M 页**。\n' +
      '(2) 页目录：2¹⁰ 项 × 4B = 4KB = 1 页；每个页表：2¹⁰ 项 × 4B = 4KB = 1 页；\n' +
      '页目录共有 2¹⁰ 个表项 → 指向 2¹⁰ = 1024 个页表 → 页目录与页表共占 = 1 + 1024 = **1025 页**。\n' +
      '(3) 虚拟地址 0100 0000H：页目录号 = 01000000H >> 22 = 0000 0001 00₂ = 4；\n' +
      '0111 2048H：二进制 0000 0001 0001 0001 …，高 10 位 = 0000 0001 00 = 4 → 两者**页目录号相同** →\n' +
      '命中同一个页目录项 → 地址转换共访问 **1 个**二级页表。\n' +
      '理由：二级页表由页目录号唯一索引，两地址的页目录号均为 4，故共享同一张二级页表\n' +
      '（页表索引分别为 0 与 112，在同一页表的不同表项）。\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 页/页框 4KB、虚拟空间 1M 页', points: 3,
          evidenceHint: '答案给出 4KB 与 1M（2²⁰）页',
          matchAny: ['4KB', '1M', '2²⁰', '2^20'],
        },
        {
          id: 'c2', description: '(2) 页目录 + 页表共占 1025 页（1 + 1024，含计算过程）', points: 4,
          evidenceHint: '答案给出 1025 页及推导',
          matchAny: ['1025', '1024'],
        },
        {
          id: 'c3', description: '(3) 共访问 1 个二级页表（页目录号相同均为 4）', points: 2,
          evidenceHint: '答案给出 1 个及页目录号比较理由',
          matchAny: ['1 个', '页目录号'],
        },
      ],
    },
  },
  47: {
    analysis:
      '【拓扑静态地址按图标注解码：路由器内网接口 111.123.15.1/24（MAC 00-a1-a1-a1-a1-a1）、\n' +
      'DHCP 服务器 111.123.15.2/24（MAC 00-b1-b1-b1-b1-b1）、WWW 服务器 111.123.15.3/24、主机 1 111.123.15.4/24】\n' +
      '(1) 网段 111.123.15.0/24 中：.0 为网络地址、.255 为广播地址、.1~.4 已静态占用 →\n' +
      'DHCP 可动态分配的最大范围 = **111.123.15.5 ~ 111.123.15.254**。\n' +
      '主机 2 尚无 IP，发送 DHCP Discover 时 IP 层尚未配置 → 封装该报文的 IP 分组：\n' +
      '源 IP = **0.0.0.0**，目的 IP = **255.255.255.255**（受限广播）。\n' +
      '(2) 主机 2 ARP 表为空，访问 Internet 时发出的第一个以太网帧是 **ARP 请求帧** →\n' +
      '目的 MAC = **FF-FF-FF-FF-FF-FF**（广播）。\n' +
      '封装「发往 Internet 的 IP 分组」的以太网帧：目的主机在网外 → 该帧发往**默认网关（路由器内网接口）** →\n' +
      '目的 MAC = 路由器接口的 **00-a1-a1-a1-a1-a1**。\n' +
      '(3) 主机 1（111.123.15.4/24，网关配为 111.123.15.2）：\n' +
      '· 访问 WWW 服务器（111.123.15.3）：目的地址与主机 1 **同网段**（同 /24）→ 直接交付，不经网关 →\n' +
      '  **可以访问**；\n' +
      '· 访问 Internet：目的在网外，分组须发往默认网关 111.123.15.2——但 .2 是 **DHCP 服务器**而非路由器，\n' +
      '  分组被交给服务器后无法向 Internet 转发（真正的网关是 .1）→ **不能访问 Internet**。\n' +
      '【各问分值为草稿拟定（本题合计 6 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 6,
      criteria: [
        {
          id: 'c1', description: '(1) DHCP 可分配范围 111.123.15.5~254（扣除网络/广播/静态地址）', points: 2,
          evidenceHint: '答案给出 5~254 范围',
          matchAny: ['111.123.15.5', '254'],
        },
        {
          id: 'c2', description: '(1) DHCP Discover：源 IP 0.0.0.0、目的 IP 255.255.255.255', points: 1,
          evidenceHint: '答案给出 0.0.0.0 与受限广播地址',
          matchAny: ['0.0.0.0', '255.255.255.255'],
        },
        {
          id: 'c3', description: '(2) 第一帧为 ARP 请求（目的 MAC 全 1 广播）；IP 分组帧目的 MAC = 网关 00-a1-a1-a1-a1-a1', points: 2,
          evidenceHint: '答案给出广播 MAC 与路由器 MAC',
          matchAny: ['FF-FF-FF-FF-FF-FF', '00-a1-a1'],
        },
        {
          id: 'c4', description: '(3) 能访问 WWW（同网段直接交付）、不能访问 Internet（网关错配到 DHCP 服务器）', points: 1,
          evidenceHint: '答案说明同网段可达与网关错配',
          matchAny: ['同', '不能', '网关'],
        },
      ],
    },
  },
};
