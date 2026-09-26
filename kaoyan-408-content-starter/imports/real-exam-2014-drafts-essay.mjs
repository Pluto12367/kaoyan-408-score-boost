// V14 内容生产轨 — 2014 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。
// rubric 遵循 rubric-v1 JSON 规范（totalPoints = Σ criteria.points）。
// ⚠ 2014 各大题官方单题分值待官方分值表（bundle 中 score=null）：以下 totalPoints 与
//   子问分值拆分为草稿拟定（合计 70 分，与 40×2+70=150 卷面结构一致），解析中已显式标注「待核」。
// 题面拆分说明：源站将 OSPF 题的表+拓扑置于 Q42、三个子问置于 Q43（引用「题 42」），
// 本草稿按各自题面作答：Q42 = 网络重建与最短路径预计算，Q43 = 三个子问。
export const draftsEssay = {
  41: {
    analysis:
      '(1) 基本设计思想：先序（递归）遍历二叉树，遍历时携带当前结点深度 d（根为 0）。\n' +
      '叶结点无孩子，其带权路径长度 = weight × d，累加到全局结果；分支结点继续向左右子树递归（深度 d+1）。\n' +
      '每个结点恰好访问一次。\n' +
      '(2) 结点类型定义（C 语言）：\n' +
      'typedef struct node {\n' +
      '    int weight;              // 叶结点的非负权值（分支结点不用）\n' +
      '    struct node *left, *right;\n' +
      '} BTNode;\n' +
      '(3) 算法（C 语言）：\n' +
      'int wpl(BTNode *p, int d) {\n' +
      '    if (p == NULL) return 0;                     // 空树贡献 0\n' +
      '    if (p->left == NULL && p->right == NULL)     // 叶结点：权值 × 路径长度\n' +
      '        return p->weight * d;\n' +
      '    return wpl(p->left, d + 1) + wpl(p->right, d + 1);   // 分支结点递归左右子树\n' +
      '}\n' +
      'int treeWPL(BTNode *root) { return wpl(root, 0); }   // 根的路径长度为 0\n' +
      '时间复杂度 O(n)（每结点访问一次），递归栈深 O(树高)。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 设计思想正确（遍历携带深度、叶结点 weight×depth 累加）', points: 4,
          evidenceHint: '答案描述递归遍历与叶结点加权累计',
          matchAny: ['遍历', '深度', '叶', 'weight', '权值'],
        },
        {
          id: 'c2', description: '(2) 结点类型定义正确（weight 域 + 左右指针）', points: 2,
          evidenceHint: '定义含 weight 与 left/right 指针',
          matchAny: ['weight', 'struct', 'left', 'right'],
        },
        {
          id: 'c3', description: '(3) 代码正确：空树返回 0、叶判定、左右递归深度 +1', points: 5,
          evidenceHint: '代码含叶结点判定与递归调用',
          matchAny: ['NULL', 'return', 'weight', 'left', 'right'],
        },
        {
          id: 'c4', description: '(3) 关键处有简要注释', points: 1,
          evidenceHint: '代码含注释',
          matchAny: ['//', '/*'],
        },
        {
          id: 'c5', description: '指出时间 O(n)（或等价说法）', points: 1,
          evidenceHint: '答案给出线性复杂度',
          matchAny: ['O(n)'],
        },
      ],
    },
  },
  42: {
    analysis:
      '【题面拆分说明：源站把 OSPF 题的 LSI 表+拓扑图放在 Q42（无子问），三个子问在 Q43 引用「题 42」。\n' +
      '本题按题面完成网络重建与最短路径预计算，供 Q43 作答；图数据待教研按原卷核对】\n' +
      '由四台路由器的 LSI 重建网络（双向链路、费用取同值）：\n' +
      '· R1(10.1.1.1) — R2(10.1.1.2)：费用 3；· R1 — R3(10.1.1.5)：费用 2；\n' +
      '· R2 — R4(10.1.1.6)：费用 4；· R3 — R4：费用 6。\n' +
      '各路由器直连网络：R1 → 192.1.1.0/24；R2 → 192.1.6.0/24；R3 → 192.1.5.0/24；R4 → 192.1.7.0/24\n' +
      '（各直连费用 1）。\n' +
      'R1 视角的 Dijkstra：到 R2 = 3；到 R3 = 2；到 R4 = min(R1→R2→R4 = 3+4 = 7, R1→R3→R4 = 2+6 = 8) = **7，经 R2**。\n' +
      '到各网络的最低费用：192.1.1.0/24 = 1（直连）；192.1.6.0/24 = 3+1 = 4（经 R2）；\n' +
      '192.1.5.0/24 = 2+1 = 3（经 R3）；192.1.7.0/24 = 7+1 = 8（经 R2 再 R4）。\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '网络邻接关系与费用重建正确（R1-R2:3、R1-R3:2、R2-R4:4、R3-R4:6）', points: 4,
          evidenceHint: '答案给出四条链路与费用',
          matchAny: ['3', '2', '4', '6'],
        },
        {
          id: 'c2', description: 'R1 到 R4 的最短路径经 R2（费用 7 < 经 R3 的 8）', points: 3,
          evidenceHint: '答案比较两条路径并取经 R2',
          matchAny: ['R2', '7', '8'],
        },
        {
          id: 'c3', description: '四个子网归属（R1/R2/R3/R4 直连网）与最低费用正确', points: 2,
          evidenceHint: '答案列出四个 /24 网络及归属',
          matchAny: ['192.1.1', '192.1.6', '192.1.5', '192.1.7'],
        },
      ],
    },
  },
  43: {
    analysis:
      '(1) R1 的路由表（路由项尽可能少；四个子网地址不连续、无法聚合，各占一项）：\n' +
      '· 目的 192.1.1.0/24 | 下一跳 —（直接交付） | 接口 Net1（R1 直连，费用 1）；\n' +
      '· 目的 192.1.5.0/24 | 下一跳 10.1.1.5 | 接口 Link2（经 R3，费用 2+1）；\n' +
      '· 目的 192.1.6.0/24 | 下一跳 10.1.1.2 | 接口 Link1（经 R2，费用 3+1）；\n' +
      '· 目的 192.1.7.0/24 | 下一跳 10.1.1.2 | 接口 Link1（经 R2→R4，费用 3+4+1=8，优于经 R3 的 2+6+1=9）。\n' +
      '(2) 主机 192.1.1.130 → 192.1.7.211：目的网络 192.1.7.0/24 → R1 查表经 **Link1** 接口转发（下一跳 R2）。\n' +
      '路径 H→R1→R2→R4→H，共 3 个路由器，每个路由器转发时 TTL 减 1 → 目的主机收到的 TTL = 64 − 3 = **61**。\n' +
      '(3) R1 新增一条 Metric=10 的链路连接 Internet → R1 的 LSI 需增加：\n' +
      '① 一条新的链路信息（Link3）：所连对端（Internet 侧路由器/网络）的标识；② Link3 的本地 IP 地址；\n' +
      '③ Link3 的费用 Metric=10。OSPF 泛洪该更新 LSI 后全网重新同步链路状态数据库。\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) R1 路由表 4 项齐全（直连 + 192.1.5/192.1.6/192.1.7，下一跳与接口正确）', points: 4,
          evidenceHint: '答案给出四个目的网络、下一跳 10.1.1.2/10.1.1.5 与接口',
          matchAny: ['10.1.1.2', '10.1.1.5', 'Link1', 'Link2'],
        },
        {
          id: 'c2', description: '(2) 经 Link1 接口转发、到达时 TTL = 61（64−3）', points: 3,
          evidenceHint: '答案给出 Link1 与 61',
          matchAny: ['Link1', '61'],
        },
        {
          id: 'c3', description: '(3) LSI 增加新链路信息：对端标识、本地 IP、Metric=10', points: 2,
          evidenceHint: '答案给出新增链路三项信息',
          matchAny: ['Link', 'Metric', 'IP'],
        },
      ],
    },
  },
  44: {
    analysis:
      '(1) 相邻指令地址相差 4（08048100H→08048104H→…），指令字长 32 位 → 地址按字节推进 →\n' +
      '存储器**按字节编址**。\n' +
      '(2) sll R4,R2,2 计算 (R2)×4 作为数组元素字节偏移（i×4）→ 数组 A 每个元素占 4 字节 = **32 位**。\n' +
      '(3) bne 的机器码 1446FFFAH：OP=000001，Rs=00010（R2），Rd=00110（R6），OFFSET = FFFAH = **−6**（补码）。\n' +
      '转移目标地址公式：目标 = (PC) + 4 + OFFSET×4（相对寻址、指令字长 4B）。\n' +
      '代入：bne 在 08048114H，取指后 PC = 08048118H → 目标 = 08048118H + (−24) = 08048118H − 18H = **08048100H**（loop）。\n' +
      '(4) 五级流水（IF ID EXE MEM WB）、按序发射按序完成、无转发、分支阻塞 3 周期。\n' +
      '发生**数据相关阻塞**的指令对（后条需读前条在 WB 才写回的寄存器，且间隔不足）：\n' +
      '· I1（sll 写 R4）→ I2（add 读 R4）；· I2（写 R4）→ I3（load 以 R4 为基址）；\n' +
      '· I3（load 写 R5）→ I4（add 读 R5）；· I5（add 写 R2）→ I6（bne 读 R2）。\n' +
      '发生**控制冒险**的是 I6（bne）：分支结果决定下一条取指地址，转移成功时已取指令作废（且引起 3 周期阻塞）。\n' +
      '指令 1 不因与指令 5 相关而阻塞的原因：同一轮迭代中 I1（读 R2）远在 I5（写 R2）**之前**执行，\n' +
      '属先读后写（反方向），不构成 RAW；下一轮迭代的 I1 到达 ID 段时，本轮 I5 早已完成 WB\n' +
      '（中间还隔着 I6 分支的 3 周期阻塞，间隔被进一步拉开），读写不在同一周期且写回先行 → 无需阻塞。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 按字节编址（地址差 4 = 指令字长 4B）', points: 2,
          evidenceHint: '答案给出字节编址',
          matchAny: ['字节'],
        },
        {
          id: 'c2', description: '(2) 数组元素 32 位（4 字节，sll 左移 2 位）', points: 3,
          evidenceHint: '答案给出 32 位/4 字节',
          matchAny: ['32', '4 字节', '4字节'],
        },
        {
          id: 'c3', description: '(3) OFFSET = FFFAH（−6）、目标 = (PC)+4+OFFSET×4 = 08048100H', points: 4,
          evidenceHint: '答案给出 FFFA 与 08048100H 及公式',
          matchAny: ['FFFA', '08048100', 'PC'],
        },
        {
          id: 'c4', description: '(4) 数据相关阻塞对：I1→I2、I2→I3、I3→I4、I5→I6', points: 2,
          evidenceHint: '答案列出四对相关指令',
          matchAny: ['R4', 'R5', 'R2', '相关'],
        },
        {
          id: 'c5', description: '(4) 控制冒险 = I6（bne）；I1 不阻塞理由（间隔充分/写回先行）', points: 2,
          evidenceHint: '答案指出分支指令与隔轮间隔原因',
          matchAny: ['bne', '分支', 'WB', '写回'],
        },
      ],
    },
  },
  45: {
    analysis:
      '(1) R2 是循环计数器 i：循环 N=1000 次，每次加 1 → P 结束时 (R2) = **1000**（03E8H）。\n' +
      '(2) 指令 Cache 数据区容量 = 16 行 × 32B = **512B**。程序段 P 共 6 条指令 × 4B = 24B，\n' +
      '全部位于 08048100H 起始的同一个 32B 主存块内 → 首次取指缺失一次后整段驻留；\n' +
      '循环 1000 次 × 6 条 = 6000 次取指，缺失 1 次 → 命中率 = (6000−1)/6000 = **5999/6000 ≈ 99.98%**。\n' +
      '(3) 溢出异常：**I4（add R1,R1,R5）**——sum 累加结果可能超出 32 位；\n' +
      '缺页异常：**I3（load R5,0(R4)）**——数组 A 未调入主存，首次访问 A[i] 必缺页。\n' +
      '对数组 A 的访问：所有元素同一页且同扇区 → **读磁盘至少 1 次**（首次缺页调入整页）；\n' +
      '每次 load 都要经地址变换查页号→页框映射 → **查 TLB 至少 1000 次**（1000 个元素各一次）。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) (R2) = 1000', points: 1,
          evidenceHint: '答案给出 1000',
          matchAny: ['1000'],
        },
        {
          id: 'c2', description: '(2) 指令 Cache 数据区 512B、命中率 5999/6000 ≈ 99.98%', points: 3,
          evidenceHint: '答案给出 512B 与 99.98%（或 5999/6000）',
          matchAny: ['512', '99.98', '5999'],
        },
        {
          id: 'c3', description: '(3) 溢出在 I4（add R1,R1,R5）、缺页在 I3（load）', points: 2,
          evidenceHint: '答案指出 add R1 溢出与 load 缺页',
          matchAny: ['add', 'load', '溢出', '缺页'],
        },
        {
          id: 'c4', description: '(3) 读磁盘至少 1 次、TLB 至少 1000 次', points: 2,
          evidenceHint: '答案给出 1 次磁盘与 1000 次 TLB',
          matchAny: ['1', '1000'],
        },
      ],
    },
  },
  46: {
    analysis:
      '(1) 连续分配，插入为第 30 条记录、文件前后均有空闲空间：最优做法是把**前 29 条整体下移一块**\n' +
      '（文件起始块前移），再把新记录写入腾出的第 1 块：读 1~29 号记录（29 次读）+ 写入 2~30 号位置\n' +
      '（29 次写）= **最少 58 次**访盘。FCB 变化：文件的**起始物理块号改变**（前移一块）、\n' +
      '**文件长度/占用块数加 1**。\n' +
      '(2) 链接分配：须先沿链读到第 29 条（读 29 块），把新记录写入新块（1 次写），再修改第 29 条的\n' +
      '链接指针使其指向新块、新块指针指向原第 30 条（改写第 29 块 1 次写）→ 共 29 + 1 + 1 = **31 次**访盘。\n' +
      '文件最大长度：每块 1KB 中 4B 为指针 → 有效数据 1020B/块；链接指针 4B 可寻址 2³² 个块 →\n' +
      '文件最大长度 = 2³² × 1020B = **4080GB（约 4TB）**。\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 连续分配最少 58 次访盘（前 29 条前移：29 读 + 29 写）', points: 3,
          evidenceHint: '答案给出 58 次及移动方向',
          matchAny: ['58', '29'],
        },
        {
          id: 'c2', description: '(1) FCB 变化：起始块号改变、文件长度（块数）加 1', points: 2,
          evidenceHint: '答案说明起始块号与长度两项变化',
          matchAny: ['起始', '长度', 'FCB'],
        },
        {
          id: 'c3', description: '(2) 链接分配 31 次访盘（29 读 + 写新块 + 改指针）', points: 2,
          evidenceHint: '答案给出 31 次',
          matchAny: ['31'],
        },
        {
          id: 'c4', description: '(2) 最大文件长度 2³²×1020B = 4080GB（约 4TB）', points: 2,
          evidenceHint: '答案给出 1020B 与 4080GB/4TB',
          matchAny: ['1020', '4080', '4TB', '2³²'],
        },
      ],
    },
  },
  47: {
    analysis:
      '信号量设计：\n' +
      'empty = 1000：缓冲区空单元数（生产者可放入件数）；\n' +
      'full = 0：缓冲区中产品数（消费者可取件数）；\n' +
      'mutex = 1：缓冲区互斥访问；\n' +
      'cMutex = 1：消费者之间的**成组互斥**——保证一个消费者连续取满 10 件之前其他消费者不能取。\n' +
      '过程：\n' +
      '生产者进程：\n' +
      'while (TRUE) {\n' +
      '    生产一件产品;\n' +
      '    P(empty);            // 无空单元则等待\n' +
      '    P(mutex);            // 进入缓冲区\n' +
      '    放入一件产品;\n' +
      '    V(mutex);\n' +
      '    V(full);             // 产品数加 1\n' +
      '}\n' +
      '消费者进程：\n' +
      'while (TRUE) {\n' +
      '    P(cMutex);           // 拿到成组取货权\n' +
      '    for (i = 0; i < 10; i++) {\n' +
      '        P(full);         // 无产品则等待\n' +
      '        P(mutex);\n' +
      '        取走一件产品;\n' +
      '        V(mutex);\n' +
      '        V(empty);        // 空单元加 1\n' +
      '    }\n' +
      '    V(cMutex);           // 取满 10 件才放行其他消费者\n' +
      '}\n' +
      '要点：P(full)/P(mutex) 放在循环体内逐件执行；cMutex 横跨 10 次取货（先申请资源类信号量、\n' +
      '后申请互斥信号量的次序在两组之间无环路，不会死锁——生产者不依赖 cMutex）。\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '信号量定义齐全：empty=1000、full=0、mutex=1 及含义', points: 3,
          evidenceHint: '答案定义三基础信号量与初值',
          matchAny: ['empty', 'full', 'mutex', '1000'],
        },
        {
          id: 'c2', description: '成组互斥信号量 cMutex=1 定义正确（保证连续取 10 件）', points: 2,
          evidenceHint: '答案有消费者成组互斥信号量',
          matchAny: ['cMutex', '10', '成组', '互斥'],
        },
        {
          id: 'c3', description: '生产者过程正确（P(empty)→P(mutex)→放入→V(mutex)→V(full)）', points: 2,
          evidenceHint: '生产者 P/V 配对正确',
          matchAny: ['P(empty)', 'P(mutex)', 'V(full)'],
        },
        {
          id: 'c4', description: '消费者过程正确（cMutex 跨 10 次，循环内 P(full)→P(mutex)→取→V(mutex)→V(empty)）', points: 2,
          evidenceHint: '消费者循环 10 次且 P/V 正确',
          matchAny: ['P(cMutex)', 'P(full)', 'V(cMutex)', '10'],
        },
      ],
    },
  },
};
