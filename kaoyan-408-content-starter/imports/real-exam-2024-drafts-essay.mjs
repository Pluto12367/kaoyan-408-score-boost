// V14-P0 R3 — 2024 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。
// Q43/Q44/Q45/Q46/Q47 原题强依赖图/表（指令格式图、存储器内容图、页表数据、
// 共享缓冲代码、网络拓扑），题面为文字化抽取，rubric 为框架级 + 待核标注。
export const draftsEssay = {
  41: {
    analysis:
      '判定拓扑序列唯一性 ⇔ 每一步（删去当前入度为 0 的顶点后）入度为 0 的顶点都恰好只有 1 个。\n' +
      '若任何一步出现 ≥2 个零入度顶点，则可任选其一，拓扑序列不唯一；若某步出现 0 个（且图未删空）则有环，无拓扑序，返回 0。\n' +
      '算法（邻接矩阵版 Kahn）：indegree[] 由矩阵逐列统计；每轮扫描找零入度顶点，\n' +
      '若 count≠1 返回相应结果；删除该顶点（其出边对应的入度减 1），重复 n 轮。\n' +
      '时间复杂度 O(n²)（矩阵扫描），空间 O(n)。',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 指出「每步零入度顶点恰为 1」是拓扑序唯一的充要条件', points: 2,
          evidenceHint: '答案明确「多于一个零入度顶点则不唯一」',
          matchAny: ['入度为 0', '零入度', '唯一'],
        },
        {
          id: 'c2', description: '(1) 指出出现环（删空前无零入度顶点）时无拓扑序，返回 0', points: 2,
          evidenceHint: '答案处理无拓扑序的情形',
          matchAny: ['环', '不存在', '返回 0'],
        },
        {
          id: 'c3', description: '(2) 邻接矩阵求入度的实现正确（逐列累加）', points: 3,
          evidenceHint: '代码含按列统计入度的循环',
          matchAny: ['Edge', 'indegree', '列'],
        },
        {
          id: 'c4', description: '(2) 逐轮扫描零入度顶点并计数的实现正确', points: 3,
          evidenceHint: '代码含每轮扫描与计数逻辑',
          matchAny: ['count', 'for', '扫描'],
        },
        {
          id: 'c5', description: '(2) 删除顶点后更新其后继入度', points: 2,
          evidenceHint: '代码对出边对应的入度减 1',
          matchAny: ['减 1', '−1', '删除'],
        },
        {
          id: 'c6', description: '复杂度说明 O(n²)（邻接矩阵扫描）', points: 1,
          evidenceHint: '答案给出复杂度及依据',
          matchAny: ['O(n²)', 'n2', '平方'],
        },
      ],
    },
  },
  42: {
    analysis:
      '平方探测散列：H0=(key×3) mod 11，第 k 次冲突探测 Hk=(H0+k²) mod 11。\n' +
      '逐关键字插入（20,3,11,18,9,14,7 → H0 分别为 60%11=5、9、33%11=0、54%11=10、27%11=5、42%11=9、21%11=10）：\n' +
      '20→5；3→9；11→0；18→10；9 冲突(5)→(5+1)%11=6；14 冲突(9)→(9+1)%11=10 冲突→(9+4)%11=2；7 冲突(10)→0 冲突→(10+4)%11=3。\n' +
      '(2) 查找 14：H0=9（比较 1 次，非 14）→H1=10（比较 2 次，非 14）→H2=(9+4)%11=2（比较 3 次，命中）。\n' +
      '(3) 查找 8：H0=24%11=2 非 8 →3 非 8 →(2+4)=6 非 8 →(2+9)%11=0 非 8 →…直到回到 H0 仍未命中 → 确认失败地址与探测序列以表为准。\n' +
      '【HT 最终布局与失败地址请按上述推演核对原卷答案；装填因子 = 7/11。】',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) HT 构造结果正确（7 个关键字位置）', points: 4,
          evidenceHint: '答案画出/列出各关键字的散列位置',
          matchAny: ['HT', '散列', '插入'],
        },
        {
          id: 'c2', description: '(1) 装填因子 = 7/11', points: 2,
          evidenceHint: '答案给出 7/11',
          matchAny: ['7/11', '装填因子'],
        },
        {
          id: 'c3', description: '(2) 查找 14 的比较序列正确（9→10→2）', points: 2,
          evidenceHint: '答案给出比较地址序列',
          matchAny: ['9', '10', '2'],
        },
        {
          id: 'c4', description: '(3) 查找 8 失败时的散列地址正确', points: 2,
          evidenceHint: '答案给出失败探测的最终地址',
          matchAny: ['失败', '地址'],
        },
      ],
    },
  },
  43: {
    analysis:
      '【原题强依赖 43(a) 指令格式图与 43(b) 数据通路图，图数据待核对】\n' +
      '已知（题面文字）：32 位定长指令字；add（R 型，R[rd]←R[rs1]+R[rs2]）、slli（移位立即数）、\n' +
      'lw（R[rd]←M[R[rs1]+imm]，imm 为补码偏移）；字段划分 31~25/24~20/19~15/14~12/11~7/6~0。\n' +
      '(1) 各指令的字段拼装：add 的 funct7+rs2 在 31~20，lw 的 imm 在 31~20——扩展器（Ext 信号）对 imm\n' +
      '做符号扩展、对 shamt 做零扩展；ALU 控制按 opcode（0110011/0010011/0000011）区分。\n' +
      '(2) 控制信号取值表：按 add/slli/lw 三条指令逐一列出 RegWrite/ALUOp/Ext/ALUSrc/存储读写等。\n' +
      '【位级编码与控制信号取值表需按 43(a)/(b) 原图核对后定稿。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) add/slli/lw 的字段拆分与功能对应正确', points: 4,
          evidenceHint: '答案按位段给出三条指令的编码解释',
          matchAny: ['rs1', 'rd', 'imm', 'shamt'],
        },
        {
          id: 'c2', description: '(1) imm 补码符号扩展 / shamt 零扩展的区分', points: 3,
          evidenceHint: '答案区分两种扩展方式',
          matchAny: ['符号扩展', '零扩展', 'Ext'],
        },
        {
          id: 'c3', description: '(2) 三条指令的控制信号取值表完整（RegWrite/ALUOp/Ext 等）', points: 4,
          evidenceHint: '答案列出每条指令的控制信号取值',
          matchAny: ['控制信号', 'RegWrite', 'ALUOp', 'ALUSrc'],
        },
        {
          id: 'c4', description: '(2) opcode 区分三类指令的说明', points: 2,
          evidenceHint: '答案按 opcode 说明译码依据',
          matchAny: ['opcode', '0110011', '0000011', '译码'],
        },
      ],
    },
  },
  44: {
    analysis:
      '【原题强依赖题 44 图（存储器内容/数据通路），图数据待核对】\n' +
      '已知（题面文字）：指令序列 s 实现 sum += a[i]；i、sum、a 均为 int；寄存器 r1~r5 编号 01H~05H。\n' +
      '(1) 从指令序列语义映射寄存器：r1 存放 a[i] 的有效地址/中间量、r3 存放数组首地址、\n' +
      'r4 存放变参 i、r5 存放 sum（按指令 add r1,r1,r5 与 lw/访存序列核对）。\n' +
      '(2) 小端方式 + 4KB 页：a[i] 地址 = r1(首址偏移) + i×4 = 0013DFF0 图中基址 + 5×4 = 0013E004H（示例推演，\n' +
      '具体按图中存储内容核对）；a[i] 与 sum 的机器数按图中小端字节序读取；a[i] 所在页号 = 地址 >> 12；\n' +
      '是否缺页由该页的装入位决定（按图核对）。\n' +
      '【a[i]/sum 的十六进制值、页号与缺页判定以题 44 图存储内容为准，待教研核对。】',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) 数组首地址/变参 i/sum 的寄存器编号正确', points: 3,
          evidenceHint: '答案逐一给出寄存器编号',
          matchAny: ['r1', 'r3', 'r4', 'r5'],
        },
        {
          id: 'c2', description: '(2) a[i] 的地址计算正确（基址 + i×4，小端读取）', points: 2,
          evidenceHint: '答案给出 a[i] 的十六进制地址与读取方式',
          matchAny: ['小端', '地址', 'i×4', '4'],
        },
        {
          id: 'c3', description: '(2) a[i] 与 sum 的机器数正确', points: 2,
          evidenceHint: '答案按图给出两个十六进制值',
          matchAny: ['H', '机器数', 'sum'],
        },
        {
          id: 'c4', description: '(2) 页号计算与缺页判定正确', points: 3,
          evidenceHint: '答案给出页号（地址高 20 位）与装入位判定',
          matchAny: ['页号', '缺页', '装入位'],
        },
      ],
    },
  },
  45: {
    analysis:
      '【原题依赖页表/页框数据图，图数据待核对】\n' +
      '背景（题面文字）：访问虚拟地址 1234 5678H 发生缺页，处理后物理地址为 BAB4 5678H，\n' +
      '页大小由 VA/PA 结构推知为 4KB（低 12 位页内偏移）。\n' +
      '(1) 缺页的虚拟页号 = 0x12345；页框号更新后 = 0xBAB45（物理地址高 20 位）；\n' +
      '该页表项的物理地址 = 页表基址 + 虚页号×表项大小；其虚拟地址需经「页表的虚拟地址」再翻译一次\n' +
      '（按题给页表基址寄存器数据计算，图数据待核对）。\n' +
      '(2) 进程页表所在页的页号、该页表项的虚拟地址与页框号：按题给页表层级与基址数据计算。\n' +
      '【页表基址/表项大小等原始数据在图中，数值答案以原图为准，待教研核对。】',
    rubric: {
      version: 1,
      totalPoints: 7,
      criteria: [
        {
          id: 'c1', description: '(1) 页表项的虚拟地址与物理地址计算方法正确', points: 3,
          evidenceHint: '答案给出 基址+虚页号×表项大小 的计算链',
          matchAny: ['页表基址', '页表项', '虚拟地址'],
        },
        {
          id: 'c2', description: '(1) 页框号更新后的值 = 0xBAB45（或按图的等价值）', points: 1,
          evidenceHint: '答案给出更新后的页框号',
          matchAny: ['BAB45', '页框号'],
        },
        {
          id: 'c3', description: '(2) 页表所在页的页号正确', points: 1,
          evidenceHint: '答案给出页号',
          matchAny: ['页号'],
        },
        {
          id: 'c4', description: '(2) 页表项的虚拟地址与页框号正确', points: 2,
          evidenceHint: '答案给出两级翻译后的地址与页框号',
          matchAny: ['虚拟地址', '页框号'],
        },
      ],
    },
  },
  46: {
    analysis:
      '【原题依赖共享缓冲 B 的代码段（C1/C2/C3），代码数据待核对】\n' +
      '(1) C1 是临界区（若 C1 读写共享缓冲 B 的指针/计数）：P1、P2 均执行 C1 时存在「读-改-写」竞争，\n' +
      '并发执行会导致状态不一致，必须互斥进入。\n' +
      '(2) B 初始为空：P1 执行 C1（放入数据）、P2 执行 C2（取走数据）——同步关系「先放后取」：\n' +
      '信号量 full=0（缓冲中有数据）、mutex=1（互斥访问 B）：P1: P(mutex);C1;V(full)；P2: P(full);P(mutex);C2;V(mutex)。\n' +
      '(3) B 不为空且 P1、P2 各执行 C3：C3 语义按代码核对（若 C3 为互斥操作则需 mutex；\n' +
      '若与缓冲数据相关则还需计数信号量）。信号量定义与 PV 序列以 C1/C2/C3 代码为准。\n' +
      '【代码文本在题 46 图/清单中，待教研核对后细化 (3)。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) 判定 C1 是临界区并给出理由（共享变量读写竞争）', points: 2,
          evidenceHint: '答案指出共享资源与一致性风险',
          matchAny: ['临界区', '共享', '竞争', '互斥'],
        },
        {
          id: 'c2', description: '(2) 信号量定义尽量少且初值正确（full=0、mutex=1）', points: 2,
          evidenceHint: '答案定义同步与互斥信号量及初值',
          matchAny: ['mutex', 'full', '初值'],
        },
        {
          id: 'c3', description: '(2) P1/P2 的 wait/signal 序列正确（先放后取）', points: 2,
          evidenceHint: '答案给出完整的 PV 操作序列',
          matchAny: ['wait', 'signal'],
        },
        {
          id: 'c4', description: '(3) 按代码语义定义信号量与 PV 序列', points: 2,
          evidenceHint: '答案按 C3 的实际语义给出设计',
          matchAny: ['C3', '信号量', 'wait', 'signal'],
        },
      ],
    },
  },
  47: {
    analysis:
      '【原题强依赖网络拓扑图（R11/R12/R13 与链路开销），图数据待核对】\n' +
      '背景（题面文字）：AS 内任意两主机通信经过路由器数可能超过 20 个。\n' +
      '(1) RIP 的最大跳数 15 限定了直径 ≤15，超过 20 个路由器的 AS 无法用 RIP → 需换 OSPF 类链路状态协议；\n' +
      '按图给出每台路由器的具体选型/理由（图数据待核对）。\n' +
      '(2)~(3) 按图计算 OSPF 最短路径/地址规划（图数据待核对）。\n' +
      '【采分点框架按「协议适用性论证 + 图上计算」两层搭建，数值以原图为准。】',
    rubric: {
      version: 1,
      totalPoints: 15,
      criteria: [
        {
          id: 'c1', description: '指出 RIP 跳数上限（15）与 AS 直径超限的矛盾', points: 4,
          evidenceHint: '答案出现 15 跳限制与超 20 路由器的论证',
          matchAny: ['RIP', '15', '跳'],
        },
        {
          id: 'c2', description: '给出适用的 IGP（OSPF）及理由（链路状态、无跳数上限）', points: 3,
          evidenceHint: '答案选择 OSPF 并说明依据',
          matchAny: ['OSPF', '链路状态', 'Dijkstra'],
        },
        {
          id: 'c3', description: '按图计算各路由器的配置/路由结论（图依赖）', points: 4,
          evidenceHint: '答案按图逐一给出路由器结论',
          matchAny: ['路由器', '路由表', '最短'],
        },
        {
          id: 'c4', description: '图上计算过程完整（最短路径树/开销累加）', points: 4,
          evidenceHint: '答案展示计算过程',
          matchAny: ['开销', '最短路径', '计算'],
        },
      ],
    },
  },
};
