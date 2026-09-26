// V14-P0 R2 — 2026 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5 授权形态），**必须经具名教研互审后方可导入**（RULE-10）。
// rubric 遵循 rubric-v1 JSON 规范（totalPoints = Σ分值，硬卡）；采分点分值
// 依据题面子问分值拆分。Q43/Q44/Q45/Q46/Q47 原题依赖图/表，题面为文字化抽取，
// 采分点框架按子问分值搭建，图内数据相关细节标注「待教研核对」。
export const draftsEssay = {
  41: {
    analysis:
      '利用 BST 的有序性做带剪枝的查找：从根出发，用 |node.key - K| 维护当前最小差与候选结点。\n' +
      '若 K < node.key，最优候选只可能在「当前结点」与「左子树」中，右子树所有关键字更大、差只会更大，剪掉右子树；\n' +
      '若 K > node.key 对称地只走右子树；若 K == node.key 差为 0，直接结束。\n' +
      '注意题目要求输出「所有」差最小的结点：BST 中与 K 差最小的结点可能有两个（如 K 介于两叶之间），\n' +
      '得到最小差 d 后，还需收集关键字落在 [K-d, K+d] 内的全部结点——可对 BST 做限定区间的中序遍历（仍可剪枝：\n' +
      'node.key < K-d 只走右子树，node.key > K+d 只走左子树）。',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '基本思想：从根出发与 K 比较、向单侧子树剪枝查找', points: 2,
          evidenceHint: '答案出现「与当前结点比较后只进入一侧子树」「K 小走左、K 大走右」等表述',
          matchAny: ['左子树', '右子树', '单侧', '剪枝', '比较'],
        },
        {
          id: 'c2', description: '维护当前最小差值并不断更新候选', points: 2,
          evidenceHint: '答案出现「最小差/abs(key-K) 更新/记录最小结点」',
          matchAny: ['最小', 'abs', '绝对值', '差'],
        },
        {
          id: 'c3', description: '指出最小差结点可能有多个并给出全部收集的策略', points: 2,
          evidenceHint: '答案提到「可能有多个」「所有结点」「差相同的结点」',
          matchAny: ['所有', '多个', '相同', '全部'],
        },
        {
          id: 'c4', description: 'C/C++ 代码：递归或迭代框架完整，查找主流程正确', points: 3,
          evidenceHint: '代码含 while/递归结构与节点比较逻辑',
          matchAny: ['while', 'if', 'return', '->'],
        },
        {
          id: 'c5', description: '代码正确处理「K 等于某结点关键字」与子树空等边界', points: 2,
          evidenceHint: '代码出现判空（NULL/nullptr）与差为 0 提前结束',
          matchAny: ['NULL', 'nullptr', '==', '0'],
        },
        {
          id: 'c6', description: '输出最小差值 d 与对应全部结点关键字（或等价的收集过程）', points: 2,
          evidenceHint: '代码/文字出现输出差值与结点关键字（可能多个）',
          matchAny: ['输出', 'printf', 'cout', '收集'],
        },
      ],
    },
  },
  42: {
    analysis:
      '判定出栈序列合法性：任一前缀中不存在 i<j<k 使 Pj < Pk < Pi（312 型），等价于直接用栈模拟——\n' +
      '按 1..n 依次入栈，每入栈后不断弹栈直到栈顶不等于当前待输出元素，最后看输出是否吻合。\n' +
      '(1) n=9 时两个 8 元序列需按模拟逐一判定（元素是否齐全、栈顶是否匹配）。\n' +
      '(2) 经典 312 律：出栈序列不合法 ⟺ 存在 i<j<k 使 Pj < Pk < Pi（Pj 最小、Pi 最大、Pk 居中）。\n' +
      '(3) n=4 以 2 开头：1、2 先入栈弹出 2 后，1 压在栈底，{1,3,4} 的合法出栈交错共 C_3=5 种。\n' +
      '(4) Catalan 递推：以 1 开头 = C_{k-1} = M；以 2 开头 = 1 固定最后弹出，其余 3..k 的出栈序共 C_{k-2}；\n' +
      '总数 C_k = C_{k-1}·(4k-2)/(k+1)。',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) 用栈模拟或等价判据正确判定两个序列可得/不可得', points: 2,
          evidenceHint: '答案对两个序列分别给出结论及依据（栈顶匹配或 312 律）',
          matchAny: ['模拟', '栈顶', '312', '入栈', '出栈'],
        },
        {
          id: 'c2', description: '(2) 给出 312 关系：Pj < Pk < Pi（或等价表述）', points: 2,
          evidenceHint: '答案出现三个元素的大小关系式且方向正确',
          matchAny: ['Pj', '大于', '小于', '之间', '中间'],
        },
        {
          id: 'c3', description: '(3) n=4 以 2 开头的序列个数 = 5', points: 2,
          evidenceHint: '答案出现 5 或 C_3=5（枚举亦可）',
          matchAny: ['5', '卡特兰', 'C3'],
        },
        {
          id: 'c4', description: '(4) 以 1 开头个数为 M，并给出以 2 开头的个数', points: 2,
          evidenceHint: '答案把「以 1 开头」与 M 建立等式，并对以 2 开头给出 Catalan(k-2) 类结果',
          matchAny: ['M', '卡特兰', 'C_k', 'Ck'],
        },
        {
          id: 'c5', description: '(4) 总出栈序列个数 = C_k = M·(4k-2)/(k+1)（或等价递推）', points: 2,
          evidenceHint: '答案给出总数与 M 的递推关系',
          matchAny: ['4k', '递推', '总数', 'Ck'],
        },
      ],
    },
  },
  43: {
    analysis:
      '【题面依赖指令格式表，表数据以原卷为准，本解析为框架性草稿】\n' +
      '(1) 寄存器宽度与主存单元宽度由指令功能的操作数位数反推：16 位机、M 型在 R[0] 与主存之间整体搬运，\n' +
      '故通用寄存器与主存单元均为 16 位。\n' +
      '(2) 各类指令的地址/偏移字段位数决定寻址范围：I 型 imm8 为 8 位立即数（可带符号），M 型 offset 为 12 位，\n' +
      '相对 R[15] 的访存范围由此推得。\n' +
      '(3) ExtOp 决定扩展器做符号扩展还是零扩展：带符号立即数（add imm）需符号扩展，M 型 offset 视地址语义\n' +
      '（无符号偏移）取零扩展；M 型的 EXTop 与 I 型不能混用，因为二者服务的指令语义不同。\n' +
      '【子问精确分值与(2)(3)的完整设问以原卷为准，待教研核对后细化。】',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) 通用寄存器宽度 = 16 位（由 M 型整字搬运推出）', points: 1,
          evidenceHint: '答案出现 16 位寄存器结论',
          matchAny: ['16 位', '16位'],
        },
        {
          id: 'c2', description: '(1) 主存单元宽度 = 16 位（M[R[15]+offset] 与 R[0] 对搬）', points: 1,
          evidenceHint: '答案出现 16 位主存/存储单元',
          matchAny: ['主存', '存储单元', '16'],
        },
        {
          id: 'c3', description: '(2) 各型指令寻址范围按字段位数正确计算', points: 3,
          evidenceHint: '答案按 imm8/offset 的位数给出范围（如 ±128、4096）',
          matchAny: ['128', '4096', '8 位', '12 位', '偏移'],
        },
        {
          id: 'c4', description: '(2) 每类指令给出正确的取指令周期/访存序列', points: 2,
          evidenceHint: '答案出现取指、译码、执行各阶段的微操作序列',
          matchAny: ['取指', 'PC', 'MAR', 'MDR'],
        },
        {
          id: 'c5', description: '(3) ExTop 取值：带符号立即数符号扩展、地址偏移零扩展（按原卷设问口径）', points: 2,
          evidenceHint: '答案区分符号扩展与零扩展的使用场合',
          matchAny: ['符号扩展', '零扩展', 'ExtOp'],
        },
        {
          id: 'c6', description: '(3) 说明 M 型 EXTop 与 I 型 EXTop 不同的原因（语义不同）', points: 1,
          evidenceHint: '答案说明两类指令扩展目的不同',
          matchAny: ['不同', '语义', '不能'],
        },
      ],
    },
  },
  44: {
    analysis:
      '【题面强依赖数据通路图，图数据以原卷为准，本解析为框架性草稿】\n' +
      '(1) 图中①②为同一类部件：多路选择器（MUX）——在多条来源总线中按控制信号选一路送出。\n' +
      '(2) I 型 imm8 可带符号或无符号，M 型 offset 的扩展方式由地址语义决定；EXTop 控制扩展器行为，\n' +
      '两类指令不能共用同一扩展结果。\n' +
      '(3) 取指周期完成 PC 增量：PC → MAR（经 MARSrc）→ 存储器读 → MDR → IR，同时 PC+指令字长 经 ALU/专用加法器\n' +
      '写回 PC，需要的控制信号包括 MARSrc、PCin、ALUOp/加法选择、RegWr 组等。\n' +
      '【子问精确设问与分值以原卷为准，待教研核对后细化。】',
    rubric: {
      version: 1,
      totalPoints: 15,
      criteria: [
        {
          id: 'c1', description: '(1) 指出①②为多路选择器 MUX', points: 1,
          evidenceHint: '答案出现 MUX/多路选择器',
          matchAny: ['MUX', '多路选择', '选择器'],
        },
        {
          id: 'c2', description: '(1) 说明其作用（按控制信号选择数据来源）', points: 1,
          evidenceHint: '答案出现「选择/选通/来源」',
          matchAny: ['选择', '选通', '来源'],
        },
        {
          id: 'c3', description: '(2) I 型与 M 型的 ExtOp 取值及理由（符号/零扩展按语义区分）', points: 3,
          evidenceHint: '答案区分带符号立即数与地址偏移的扩展方式',
          matchAny: ['符号扩展', '零扩展', 'ExtOp', '扩展'],
        },
        {
          id: 'c4', description: '(2) 说明两类指令 EXTop 不能相同的语义原因', points: 2,
          evidenceHint: '答案说明数据解释不同（数值 vs 地址）',
          matchAny: ['地址', '数值', '语义', '不同'],
        },
        {
          id: 'c5', description: '(3) 取指周期数据通路微操作序列正确（PC→MAR→存储器→MDR→IR）', points: 4,
          evidenceHint: '答案出现完整取指流程',
          matchAny: ['MAR', 'MDR', 'IR', '存储器'],
        },
        {
          id: 'c6', description: '(3) PC 增量路径正确（经 ALU/加法器写回 PC）', points: 2,
          evidenceHint: '答案出现 PC+1/PC 增量与写回',
          matchAny: ['PC', '增量', '+1', '加法'],
        },
        {
          id: 'c7', description: '(3) 列出所需控制信号并说明生效节拍', points: 2,
          evidenceHint: '答案列出 MARSrc/PCin 等控制信号及时序',
          matchAny: ['控制信号', 'PCin', 'MARSrc', '节拍'],
        },
      ],
    },
  },
  45: {
    analysis:
      '【题面含进程表（图数据已扁平化，数值以原卷为准）】\n' +
      '调度规则：优先级高者优先 + 时间片轮转（时间片 50ms），时钟中断每 10ms 触发一次抢占检查；\n' +
      '时间片用完优先级 -1，被抢占优先级不变；同优先级 FIFO。\n' +
      '(1) 从 10ms 起逐中断推演：每个时钟中断可能触发一次切换；统计中断次数与 CPU 调度（切换到某进程运行）次数，\n' +
      '并记录 P1–P4 首次获得 CPU 的时刻。推演过程需按原卷进程表数值进行（本草稿不臆造数值）。\n' +
      '(2) 时间片 50→100ms：单次调度后连续运行更长，切换次数减少 → CPU 调度次数减少；\n' +
      '时钟中断间隔 10ms→1ms：中断频率提高 10 倍，中断处理/上下文检查开销增大。',
    rubric: {
      version: 1,
      totalPoints: 7,
      criteria: [
        {
          id: 'c1', description: '(1) 按中断逐拍正确推演调度过程（进程占用区间与切换点）', points: 2,
          evidenceHint: '答案给出各时间段的占用进程表/甘特描述',
          matchAny: ['ms', '时间片', '抢占', '就绪'],
        },
        {
          id: 'c2', description: '(1) 中断次数与 CPU 调度次数两个计数正确', points: 1,
          evidenceHint: '答案给出两个数字',
          matchAny: ['中断', '调度次数', '次'],
        },
        {
          id: 'c3', description: '(1) P1–P4 各自首次调度时刻全部正确', points: 2,
          evidenceHint: '答案按进程逐一给出时刻',
          matchAny: ['P1', 'P2', 'P3', 'P4'],
        },
        {
          id: 'c4', description: '(2) 时间片增大 → CPU 调度次数减少（理由：单次连续运行更长）', points: 1,
          evidenceHint: '答案出现「减少」及理由',
          matchAny: ['减少', '更长', '切换'],
        },
        {
          id: 'c5', description: '(2) 时钟间隔 10ms→1ms → 系统开销增大（中断频率提高）', points: 1,
          evidenceHint: '答案出现「增大」及中断频率理由',
          matchAny: ['增大', '频繁', '中断'],
        },
      ],
    },
  },
  46: {
    analysis:
      '【题面含目录结构图与 inode 表（已扁平化，数值以原卷为准）】\n' +
      '已知条件（题面文字）：盘块 4KB、盘块号 4B；inode 表自盘块 100 起连续 4096 盘块；inode 128B，\n' +
      '直接地址 5 个 + 一二三级间接各 1；file 的 inode 号 1000、file 占 30KB。\n' +
      '(1) file 的 inode 所在盘块 = 100 + ⌊1000/(4096/128)⌋ = 100 + ⌊1000/32⌋ = 100 + 31 = 131。\n' +
      '访问偏移 21460：21460/4096 = 5.24 → 第 5 个块索引（0 起）落在一级间接范围（直接块覆盖 5×4096=20480 < 21460），\n' +
      'inode 已在内存时最多再读「一级间接地址块 + 数据块」2 个盘块。\n' +
      '最多可存放文件数受 inode 总数（4096×32=131072）与位图容量共同约束，取较小者——具体数值需原卷位图尺寸核对。\n' +
      '(2) 删除目录 dir1：删除目录项（父目录中移除条目）、回收 dir1 下全部文件的 inode（清 inode 位图、\n' +
      '链接计数置 0）、释放其数据块与间接块（清数据位图）、若目录为空还需处理空目录本身的 inode 与数据块。\n' +
      '【(1) 中位图尺寸与 (2) 的精确采分表述以原卷图为准，待教研核对。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) file 的 inode 所在盘块号 = 131（100 + ⌊1000/32⌋）', points: 1,
          evidenceHint: '答案出现 131 或等价计算过程',
          matchAny: ['131', '1000', '32'],
        },
        {
          id: 'c2', description: '(1) 偏移 21460 需经一级间接：最多再读 2 个盘块（间址块+数据块）', points: 1,
          evidenceHint: '答案出现一级间接与 2 块结论',
          matchAny: ['一级间接', '2', '间址'],
        },
        {
          id: 'c3', description: '(1) 最多可存放文件数（按 inode 总量/位图约束给出并说明依据）', points: 1,
          evidenceHint: '答案给出文件总数及其约束来源',
          matchAny: ['131072', '文件数', '位图', 'inode 总数'],
        },
        {
          id: 'c4', description: '(2) 删除父目录中 dir1 的目录项', points: 1,
          evidenceHint: '答案提到删除目录项/目录项回收',
          matchAny: ['目录项', '删除'],
        },
        {
          id: 'c5', description: '(2) 回收 dir1 下文件的数据块（清数据位图）', points: 1,
          evidenceHint: '答案提到数据块/位图回收',
          matchAny: ['数据块', '位图', '释放', '回收'],
        },
        {
          id: 'c6', description: '(2) 回收相应 inode（清 inode 位图、链接计数处理）', points: 2,
          evidenceHint: '答案提到 inode 回收/链接计数',
          matchAny: ['inode', '链接计数', 'i 节点'],
        },
        {
          id: 'c7', description: '(2) 处理空目录本身（dir1 的 inode 与数据块回收/父目录链维护）', points: 1,
          evidenceHint: '答案提到空目录或 dir1 自身的元数据处理',
          matchAny: ['空目录', 'dir1', '父目录'],
        },
      ],
    },
  },
  47: {
    analysis:
      '【题面含传输场景图（已扁平化，数值以题面文字为准）】\n' +
      '已知：cwnd 初始阈值 8 MSS、MSS=500B、逐段确认、rwnd=1000B 恒定、RTT=5ms、C 初始序号 1000、Si 初始序号 2000。\n' +
      '(1) 三次握手需要 3 次报文交换；C 收到的 SYN+ACK 段中 ack_seq = C 的初始序号+1 = 1001。\n' +
      '(2) C 收到 ACK(seq=2001, ack_seq=2001, rwnd=1000) 后：慢启动阶段每收到一个 ACK cwnd 增加 1 MSS，\n' +
      'cwnd 从 1 MSS 增至 2 MSS；发送窗口 = min(cwnd, rwnd) = min(1000, 1000) = 1000B。\n' +
      '（具体推演轮次按原卷问题口径核对。）\n' +
      '(3) 释放连接为四次挥手；「C 确定 Si 已成功接收文件」需要 C 收到对最后字节的 ACK 并完成挥手\n' +
      '（含 TIME_WAIT 语义的确认），时刻按 RTT 与各段传输时延推演。',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 三次握手，次数正确', points: 1,
          evidenceHint: '答案出现 3 次/三次握手',
          matchAny: ['3 次', '三次', '握手'],
        },
        {
          id: 'c2', description: '(1) SYN+ACK 的确认序号 ack_seq = 1001', points: 1,
          evidenceHint: '答案出现 1001',
          matchAny: ['1001'],
        },
        {
          id: 'c3', description: '(2) 慢启动推演正确（每 ACK +1 MSS，cwnd 变化给出）', points: 2,
          evidenceHint: '答案出现慢启动与 cwnd/MSS 数值推演',
          matchAny: ['慢启动', 'cwnd', '拥塞窗口', 'MSS'],
        },
        {
          id: 'c4', description: '(2) 发送窗口 = min(cwnd, rwnd) = 1000B', points: 1,
          evidenceHint: '答案出现发送窗口取小者的结论',
          matchAny: ['发送窗口', 'min', '1000', 'rwnd'],
        },
        {
          id: 'c5', description: '(3) 四次挥手过程完整（FIN/ACK 序列）', points: 2,
          evidenceHint: '答案描述四次挥手各报文',
          matchAny: ['四次挥手', 'FIN', 'ACK', '挥手'],
        },
        {
          id: 'c6', description: '(3) C 确定 Si 成功接收文件的时刻推演正确（按 ACK 到达/挥手时序）', points: 2,
          evidenceHint: '答案给出明确时刻数值及推演依据',
          matchAny: ['RTT', '时刻', 'ms', '确认'],
        },
      ],
    },
  },
};
