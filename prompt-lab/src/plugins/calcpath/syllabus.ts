export interface SyllabusChapter { id: string; title: string; phase: '单变量基础' | '单变量进阶' | '多变量与向量' | '微分方程'; sections: string[]; bridge?: string }

/** 参考经典大学微积分的主题覆盖重新组织；标题与教学内容均为 CalcPath 原创表述。 */
export const CALCPATH_SYLLABUS: SyllabusChapter[] = [
  { id: 'functions', title: '函数：描述变化的语言', phase: '单变量基础', bridge: '高中函数、三角、指数与对数', sections: ['函数与图像', '函数组合、平移与伸缩', '三角函数模型', '指数增长与衰减', '反函数与对数'] },
  { id: 'limits', title: '极限与连续', phase: '单变量基础', bridge: '代数变形、图像趋势与无限趋近', sections: ['变化率与曲线切线', '函数极限与运算法则', '极限的精确定义', '单侧极限', '连续性', '无穷极限与渐近线'] },
  { id: 'derivatives', title: '导数：局部变化', phase: '单变量基础', bridge: '斜率、平均速度与复合函数', sections: ['一点处的导数', '导函数', '基本求导法则', '变化率解释', '三角函数求导', '链式法则', '隐函数求导', '反函数与对数求导', '相关变化率', '线性近似与微分'] },
  { id: 'derivative-applications', title: '导数的应用', phase: '单变量基础', sections: ['极值问题', '中值定理', '单调性与一阶导数检验', '凹凸性与曲线描绘', '不定式与洛必达法则', '实际优化', 'Newton 方法', '原函数'] },
  { id: 'integrals', title: '积分：整体累积', phase: '单变量基础', bridge: '面积、有限求和与导数', sections: ['有限和估计面积', 'Σ 记号与和的极限', '定积分', '微积分基本定理', '不定积分与换元', '定积分换元与曲线间面积'] },
  { id: 'integral-applications', title: '定积分的应用', phase: '单变量进阶', sections: ['截面法求体积', '柱壳法', '弧长', '旋转曲面面积', '功与流体压力', '矩与质心'] },
  { id: 'transcendental', title: '超越函数与增长模型', phase: '单变量进阶', sections: ['反函数及其导数', '自然对数', '指数函数', '指数变化与可分离方程', '反三角函数', '双曲函数', '增长率比较'] },
  { id: 'integration-techniques', title: '积分技巧', phase: '单变量进阶', sections: ['基本积分公式', '分部积分', '三角积分', '三角换元', '部分分式', '计算机代数工具', '数值积分', '反常积分', '概率密度'] },
  { id: 'first-order-odes', title: '一阶微分方程', phase: '微分方程', sections: ['解、方向场与 Euler 方法', '一阶线性方程', '增长与混合模型', '自治方程图解', '方程组与相平面'] },
  { id: 'series', title: '无穷数列与级数', phase: '单变量进阶', sections: ['数列', '无穷级数', '积分判别法', '比较判别法', '绝对收敛与比值、根值判别', '交错级数', '幂级数', 'Taylor 与 Maclaurin 级数', 'Taylor 级数的收敛'] },
  { id: 'parametric-polar', title: '参数曲线与极坐标', phase: '多变量与向量', sections: ['平面曲线参数化', '参数曲线微积分', '极坐标', '极坐标图像', '极坐标面积与弧长', '圆锥曲线'] },
  { id: 'space-vectors', title: '空间几何与向量', phase: '多变量与向量', sections: ['三维坐标系', '向量', '点积', '叉积', '空间直线与平面', '柱面与二次曲面'] },
  { id: 'vector-functions', title: '向量值函数与空间运动', phase: '多变量与向量', sections: ['空间曲线与切线', '向量函数积分与抛体运动', '空间弧长', '曲率与法向量', '加速度的切向与法向分量'] },
  { id: 'partial-derivatives', title: '多元函数与偏导数', phase: '多变量与向量', sections: ['多元函数', '高维极限与连续', '偏导数', '多元链式法则', '方向导数与梯度', '切平面与微分', '极值与鞍点', 'Lagrange 乘子'] },
  { id: 'multiple-integrals', title: '多重积分', phase: '多变量与向量', sections: ['矩形区域上的二重积分', '一般区域上的二重积分', '面积与极坐标二重积分', '三重积分', '柱面与球面坐标', '多重积分换元'] },
  { id: 'vector-calculus', title: '向量场与积分定理', phase: '多变量与向量', sections: ['标量线积分', '功、环流与通量', '保守场与势函数', 'Green 定理', '曲面与面积', '曲面积分', 'Stokes 定理', '散度定理'] },
  { id: 'second-order-odes', title: '二阶微分方程', phase: '微分方程', sections: ['二阶线性方程', '非齐次线性方程', '振动与工程应用', 'Euler 方程', '幂级数解法'] },
];

export const syllabusStats = { chapters: CALCPATH_SYLLABUS.length, sections: CALCPATH_SYLLABUS.reduce((sum, chapter) => sum + chapter.sections.length, 0) };
