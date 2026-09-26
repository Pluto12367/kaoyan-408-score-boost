// V14-P0 R3 — 2025 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。
// rubric 遵循 rubric-v1 JSON 规范（totalPoints = Σ分值 = 官方分值，硬卡）。
// 子问分值拆分：题面未给出各问分值的，由草稿拟定并在 criteria 中标注「待核」。
// Q42/Q43/Q44/Q46/Q47 原题依赖图/表，采分点按文字化题面搭建，图数据待核对。
export const draftsEssay = {
  41: {
    analysis:
      'res[i] = max{ A[i]×A[j] : i ≤ j ≤ n−1 }，包含 j=i 的自乘。关键观察：乘积最大只可能来自\n' +
      '「后缀最大值 × A[i]」或「后缀最小值 × A[i]」（负×负得正，A[i] 为负时与最小值相乘才可能最大）。\n' +
      '从右往左单趟扫描：维护当前后缀 sufMax 与 sufMin，res[i] = max(A[i]×sufMax, A[i]×sufMin, A[i]×A[i])，\n' +
      '再把自己并入后缀。验证样例 A={1,4,−9,6}：res[3]=36；res[2]=max(−9×6, −9×−9)=81；res[1]=24；res[0]=6 ✓。\n' +
      '时间 O(n)，辅助空间 O(1)（res 不计）。',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 指出从右向左单趟扫描、维护后缀极值的总体思想', points: 2,
          evidenceHint: '答案出现「从右/后缀/单趟」表述',
          matchAny: ['从右', '后缀', '一趟', '扫描'],
        },
        {
          id: 'c2', description: '(1) 同时维护后缀最大与后缀最小（负负得正）', points: 2,
          evidenceHint: '答案同时出现最大值与最小值两个维护量',
          matchAny: ['最小', '最大', '负'],
        },
        {
          id: 'c3', description: '(1) 指出 j=i 时 A[i]×A[i] 也是候选', points: 1,
          evidenceHint: '答案考虑自身相乘（如 −9²）',
          matchAny: ['自身', '平方', 'i=j', 'j=i'],
        },
        {
          id: 'c4', description: '(2) 代码框架完整（循环边界、res 写入）', points: 3,
          evidenceHint: '代码含 for/while、res[i] 赋值、函数签名',
          matchAny: ['for', 'res[', 'calMulMax'],
        },
        {
          id: 'c5', description: '(2) 后缀极值初始化与更新正确（含符号处理）', points: 3,
          evidenceHint: '代码初始化末元素并按 A[i] 与极值相乘比较更新',
          matchAny: ['sufMax', 'sufMin', 'max', 'min', '初始化'],
        },
        {
          id: 'c6', description: '(2) 关键处有注释、逻辑可读', points: 1,
          evidenceHint: '代码含 // 注释说明关键步骤',
          matchAny: ['//', '/*'],
        },
        {
          id: 'c7', description: '(3) 时间 O(n)、空间 O(1)（res 除外）并给出理由', points: 1,
          evidenceHint: '答案给出两个复杂度及单趟扫描依据',
          matchAny: ['O(n)', 'O(1)'],
        },
      ],
    },
  },
  42: {
    analysis:
      '【原题依赖 AOE 网图（活动 a–n 及持续时间），图数据待核对；各子问分值题面未给出，以下拆分为草稿拟定】\n' +
      '解题框架：(1) 求所有事件的最早/最迟发生时间，关键路径长度即最短工期，关键是 e=l 的活动；\n' +
      '(2) 与 e 并行的活动 = 与 e 无先后依赖（不在同一路径段上先后衔接）的活动集合；\n' +
      '(3) 时间余量 = l − e（最迟开始 − 最早开始），逐活动求差取最大；\n' +
      '(4) 活动 b 延迟到时刻 6 开始相当于 b 的最早开始时间被推后：若 b 在关键路径上则压缩量直接等于延迟量，\n' +
      '若不在关键路径则其时间余量决定能承受的延迟；不改变 b 时，压缩 b 所在路径下游的关键活动。\n' +
      '【数值结论（最短工期/关键活动集合/最大余量活动）以图上计算为准，待教研按原图核定。】',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) 正确计算各事件最早/最迟时间并给出最短工期', points: 3,
          evidenceHint: '答案给出工期数值与 e/l 的计算表',
          matchAny: ['最早', '最迟', '工期', '关键路径'],
        },
        {
          id: 'c2', description: '(1) 关键活动集合正确（e=l 判据）', points: 1,
          evidenceHint: '答案列出关键活动且用 e=l 判据',
          matchAny: ['关键活动', 'e=l', '余量为 0'],
        },
        {
          id: 'c3', description: '(2) 与 e 并行的活动集合正确（无先后约束）', points: 2,
          evidenceHint: '答案列出与 e 可同时进行的活动',
          matchAny: ['同时', '并行'],
        },
        {
          id: 'c4', description: '(3) 时间余量最大的活动及其余量数值正确', points: 2,
          evidenceHint: '答案给出活动名与余量值',
          matchAny: ['余量', 'l−e', 'l-e'],
        },
        {
          id: 'c5', description: '(4) b 延迟后的压缩量/可压缩活动分析正确', points: 2,
          evidenceHint: '答案给出 b 的最长持续时间或可压缩活动及依据',
          matchAny: ['压缩', '延期', '持续时间'],
        },
      ],
    },
  },
  43: {
    analysis:
      '关键参数：32KB 数据区 ÷ 64B 块 ÷ 8 路 = 64 组 → 组号 6 位、块内地址 6 位；\n' +
      'VA 的页内偏移 12 位（4KB 页）覆盖块内地址+组号 → VA[11:6] 作 Cache 索引。\n' +
      '(2) d[100] VA = 0x01800020 + 100×4 = 0x018001B0；主存块号 = 0x018001B0 >> 6，组号 = 块号 mod 64 = 6。\n' +
      '(3) d[0] 位于起始地址 0x…20，块内偏移 = 0x20 = 32。int 数组 2048 元素、顺序读改写：\n' +
      '每 16 个元素共享 64B 块，块首元素首次读缺失后同块其余元素全命中；写访问命中刚调入的块。\n' +
      '按「读+写」合计 4096 次访问、128 次缺失 → 缺失率 3.13%；\n' +
      '平均访问时间 = 0.96875×2 + 0.03125×(2+200) = 8.25 时钟周期。\n' +
      '【口径待核：若仅统计读访问（2048 次），缺失率为 6.25%、平均时间 14.5 周期——按原卷答案口径定稿。】\n' +
      '(4) d 占 8192B，起始偏移 0x20 跨页边界 → 分布在 2 页；顺序访问引发缺页 2 次。',
    rubric: {
      version: 1,
      totalPoints: 14,
      criteria: [
        {
          id: 'c1', description: '(1) 组号 6 位、块内地址 6 位（64 组）', points: 1,
          evidenceHint: '答案出现 6 位/64 组',
          matchAny: ['64 组', '6 位'],
        },
        {
          id: 'c2', description: '(1) 指出 VA[11:6] 可作 Cache 索引（页内偏移覆盖）', points: 2,
          evidenceHint: '答案说明页内偏移低 12 位与块地址一致',
          matchAny: ['11:6', '页内偏移', '索引'],
        },
        {
          id: 'c3', description: '(2) d[100] 的 VA = 0180 01B0H', points: 2,
          evidenceHint: '答案给出 018001B0 或等价计算',
          matchAny: ['018001B0', '01B0', '400'],
        },
        {
          id: 'c4', description: '(2) 对应 Cache 组号 = 6', points: 1,
          evidenceHint: '答案给出组号 6',
          matchAny: ['组号', '6'],
        },
        {
          id: 'c5', description: '(3) d[0] 块内偏移 = 32（0x20）', points: 1,
          evidenceHint: '答案给出 32 或 0x20',
          matchAny: ['32', '0x20'],
        },
        {
          id: 'c6', description: '(3) 缺失率计算（128/4096 = 3.13%，口径与原卷一致）', points: 3,
          evidenceHint: '答案给出缺失率百分比与统计口径',
          matchAny: ['3.13', '缺失率', '128'],
        },
        {
          id: 'c7', description: '(3) 平均访问时间计算（命中/缺失加权）', points: 2,
          evidenceHint: '答案给出加权平均式与数值',
          matchAny: ['平均', '8.25', '14.5', '加权'],
        },
        {
          id: 'c8', description: '(4) d 分布 2 页、缺页 2 次', points: 2,
          evidenceHint: '答案给出 2 页与 2 次缺页（跨页边界说明）',
          matchAny: ['2 页', '缺页', '跨页'],
        },
      ],
    },
  },
  44: {
    analysis:
      '【原题依赖补码除法器结构图，图数据待核对】\n' +
      '(1) {R0,R1} ← SEXT(R1)：d[i]=0x87654321 符号位为 1 → R0=FFFFFFFFH（高位符号扩展）；\n' +
      'Q（被除数/商寄存器）= 87654321H；R（余数寄存器）初始 = 00000000H；Y（除数寄存器）= x = 000000FFH。\n' +
      '计数器位于控制逻辑（图中「控制逻辑」部件内）；补码除法（加减交替法）中 ALUop 控制的运算为\n' +
      '「减法」（余数左移后减除数）与「加法」（余数为负时加除数）两种。\n' +
      '(2) 除法异常的触发条件：①除数 x=0；②商溢出 32 位（典型：被除数为最小负数 0x80000000 且除数为 −1）。\n' +
      '给出对应 d[i] 与 x 的取值组合。(3) CPU 异常响应流程：硬件完成关中断、保存断点（PC/PSW）、\n' +
      '由异常类型引出服务例程入口；软件保存现场、执行除法异常处理（如返回错误码）、恢复现场并返回。\n' +
      '【子问精确分值以原卷为准，草稿按 4+3+2 拟定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) R0=FFFFFFFF、Q=87654321、R=0、Y=000000FF', points: 2,
          evidenceHint: '答案给出四个寄存器初值（符号扩展正确）',
          matchAny: ['FFFFFFFF', '87654321', 'FF', '符号扩展'],
        },
        {
          id: 'c2', description: '(1) 计数器位于控制逻辑部件', points: 1,
          evidenceHint: '答案指出控制逻辑内含计数器',
          matchAny: ['控制逻辑', '计数器'],
        },
        {
          id: 'c3', description: '(1) ALUop 控制的运算为加法与减法（加减交替法）', points: 1,
          evidenceHint: '答案列出加、减两种运算',
          matchAny: ['加', '减', '交替'],
        },
        {
          id: 'c4', description: '(2) 除数为 0 时触发除法异常', points: 1,
          evidenceHint: '答案给出 x=0 的情形',
          matchAny: ['除数', '0'],
        },
        {
          id: 'c5', description: '(2) 商溢出（如 0x80000000 ÷ −1）触发异常', points: 1,
          evidenceHint: '答案给出最小负数除以 −1 的溢出组合',
          matchAny: ['80000000', '溢出', '商'],
        },
        {
          id: 'c6', description: '(3) 异常响应：硬件保存断点/关中断、引出入口', points: 2,
          evidenceHint: '答案描述硬件响应阶段',
          matchAny: ['断点', '关中断', '入口', '保存'],
        },
        {
          id: 'c7', description: '(3) 软件处理与返回（保存现场、处理、恢复）', points: 1,
          evidenceHint: '答案描述软件阶段流程',
          matchAny: ['现场', '恢复', '处理'],
        },
      ],
    },
  },
  45: {
    analysis:
      '同步设计（信号量尽量少，共 5 个）：\n' +
      'shovel=1（铁锹互斥）、bucket=1（水桶互斥）、empty=3（空坑容量，坑数<3 才能挖）、\n' +
      'pit=0（已挖好待栽的坑数）、filled=0（已填土待浇水的树数）。\n' +
      '甲：P(empty) → P(shovel) → 挖坑 → V(shovel) → V(pit)。\n' +
      '乙：P(pit) → P(shovel) → 放苗并填土 → V(shovel) → V(filled)。\n' +
      '丙：P(filled) → P(bucket) → 浇水 → V(bucket) → V(empty)（坑释放，甲可继续挖）。\n' +
      '死锁避免：乙的 P(pit) 在 P(shovel) 之前、丙的 P(filled) 在 P(bucket) 之前，资源申请顺序一致，不会循环等待。',
    rubric: {
      version: 1,
      totalPoints: 7,
      criteria: [
        {
          id: 'c1', description: '互斥信号量 shovel、bucket（初值 1）定义正确', points: 2,
          evidenceHint: '答案定义两个工具的互斥信号量',
          matchAny: ['shovel', 'bucket', '铁锹', '水桶', '互斥'],
        },
        {
          id: 'c2', description: 'empty=3 约束「坑数小于 3 才能挖」', points: 1,
          evidenceHint: '答案出现初值 3 的容量信号量',
          matchAny: ['3', 'empty', '坑'],
        },
        {
          id: 'c3', description: '同步信号量 pit、filled（初值 0）及三人间的先后关系正确', points: 2,
          evidenceHint: '答案出现挖坑→栽苗→浇水的同步信号量链',
          matchAny: ['pit', 'filled', '同步', '0'],
        },
        {
          id: 'c4', description: '三人的 wait/signal 序列完整正确、无死锁', points: 2,
          evidenceHint: '答案给出三人各自的 PV 操作序列且顺序无死锁',
          matchAny: ['wait', 'signal', 'P(', 'V('],
        },
      ],
    },
  },
  46: {
    analysis:
      '(1) PCB 在操作系统内核区（内核管理进程的控制结构，不暴露给用户地址空间的常规区）；\n' +
      'scanf 等待键盘输入时进程处于阻塞态（等待 I/O 完成）。\n' +
      '(2) main 的代码在只读代码段；直接调用的函数中 scanf 与 printf 的功能最终要经驱动程序实现\n' +
      '（键盘驱动/显示驱动），malloc、free、strlen 不需要（库函数/内核内存管理）。\n' +
      '(3) ptr 是全局指针变量 → 读/写数据段；length 是局部变量 → 用户栈；\n' +
      'ptr 指向的字符串由 malloc 分配 → 动态生成的堆。',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) PCB 位于操作系统内核区', points: 1,
          evidenceHint: '答案指出内核区',
          matchAny: ['内核', 'PCB'],
        },
        {
          id: 'c2', description: '(1) scanf 等待时进程处于阻塞态', points: 1,
          evidenceHint: '答案指出阻塞（等待 I/O）',
          matchAny: ['阻塞', '等待', '睡眠'],
        },
        {
          id: 'c3', description: '(2) main 位于只读代码段', points: 1,
          evidenceHint: '答案指出代码段/正文段',
          matchAny: ['代码段', '只读'],
        },
        {
          id: 'c4', description: '(2) scanf、printf 需经驱动程序实现', points: 2,
          evidenceHint: '答案把 I/O 类函数归到驱动',
          matchAny: ['scanf', 'printf', '驱动'],
        },
        {
          id: 'c5', description: '(3) ptr 在读/写数据段、length 在用户栈、字符串在堆', points: 3,
          evidenceHint: '答案对三个存储位置逐一正确',
          matchAny: ['数据段', '栈', '堆'],
        },
      ],
    },
  },
  47: {
    analysis:
      '(1) 单向传播时延 = 36000km ÷ 300000km/s = 0.12s = 120ms；最大吞吐量 = 链路瓶颈 200kbps；\n' +
      '4000B=32000bit 的发送时延 = 32000/200k = 160ms，最后一位到达需再加单向传播 120ms → 至少 280ms。\n' +
      '(2) GBN 信道利用率 U = W·Tt / (Tt + 2Tp) ≥ 0.8：Tt = 1500×8/200k = 60ms，2Tp = 240ms\n' +
      '→ W ≥ 0.8×300/60 = 4 → 发送窗口至少 4；GBN 序号需 ≥ W+1 = 5 → 至少 3 bit。\n' +
      '(3) VLSM：管理区已占 10.10.10.0/26（10.10.10.33 属该块）；作业区 ≥60 主机取 10.10.10.64/26；\n' +
      '生活区 ≥120 主机取 10.10.10.128/25（126 可用）→ 作业区 10.10.10.64/26、生活区 10.10.10.128/25。\n' +
      '【(1) 的 Internet 段带宽与 (3) 的地址块划分以原图为准，待核对。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 单向传播时延 120ms', points: 1,
          evidenceHint: '答案出现 120ms（36000/300000）',
          matchAny: ['120'],
        },
        {
          id: 'c2', description: '(1) 最大吞吐量 = 200kbps（瓶颈链路）', points: 1,
          evidenceHint: '答案给出 200kbps',
          matchAny: ['200kbps', '200 kbps', '200k'],
        },
        {
          id: 'c3', description: '(1) 4000B 至少 280ms（发送 160ms + 传播 120ms）', points: 2,
          evidenceHint: '答案给出 280ms 或等价的 160+120 推导',
          matchAny: ['280', '160', '发送时延'],
        },
        {
          id: 'c4', description: '(2) 发送窗口至少 4（利用率公式求解）', points: 1,
          evidenceHint: '答案给出 W=4 及利用率推导',
          matchAny: ['利用率', '窗口', 'W'],
        },
        {
          id: 'c5', description: '(2) 序号至少 5（3 bit）', points: 1,
          evidenceHint: '答案给出序号 5 或 3 比特',
          matchAny: ['序号', '3 bit', '5'],
        },
        {
          id: 'c6', description: '(3) 作业区与生活区子网地址正确', points: 3,
          evidenceHint: '答案给出 10.10.10.64/26 与 10.10.10.128/25',
          matchAny: ['10.10.10.64', '10.10.10.128', '/26', '/25'],
        },
      ],
    },
  },
};
