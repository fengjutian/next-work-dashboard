export type StyleFamilyId = 'editorial' | 'colorblock' | 'dream' | 'couture' | 'dark' | 'oriental' | 'print' | 'cinematic';

export interface StyleFamily { id: StyleFamilyId; label: string; description: string }
export interface StyleRecipe { id: string; family: StyleFamilyId; label: string; description: string; prompt: string; accent: string }

export const STYLE_FAMILIES: StyleFamily[] = [
  { id: 'editorial', label: '极简编辑', description: '留白、线条与克制色彩' },
  { id: 'colorblock', label: '撞色时装', description: '硬边色块与封面张力' },
  { id: 'dream', label: '柔焦梦幻', description: '柔光、雾感与胶片颗粒' },
  { id: 'couture', label: '纯白高定', description: '高曝光与精致材质' },
  { id: 'dark', label: '暗黑时尚', description: '深色层次与局部硬光' },
  { id: 'oriental', label: '东方诗意', description: '东方色彩与诗性留白' },
  { id: 'print', label: '复古印刷', description: '旧纸、套色与版画颗粒' },
  { id: 'cinematic', label: '电影叙事', description: '镜头语言与尺度反差' },
];

const recipe = (id: string, family: StyleFamilyId, label: string, description: string, accent: string, prompt: string): StyleRecipe => ({ id, family, label, description, accent, prompt });

export const STYLE_RECIPES: StyleRecipe[] = [
  recipe('refined-minimal', 'editorial', '精致极简', '中性色留白，少量亮色聚焦', '#d9c7af', 'refined minimalist editorial illustration, clean flowing lines, soft neutral palette, generous negative space, one restrained accent color, premium magazine composition'),
  recipe('modern-minimal', 'editorial', '极简现代', '奶白、鼠尾草绿与纸张颗粒', '#91a68b', 'modern Nordic and Korean editorial line art, warm ivory, sage green and ink-black shapes, subtle aged-paper grain, balanced negative space'),
  recipe('ice-blue-minimal', 'editorial', '极简冰蓝', '冷调几何与半透明叠层', '#9dc7df', 'ice-blue minimalist illustration, elegant line work, abstract geometry, translucent layered shapes, cool clean atmosphere'),
  recipe('blue-white-fashion', 'colorblock', '蓝白时尚', '锐利蓝白色块与硬边阴影', '#2563a9', 'blue-and-white fashion editorial, sharp large color blocks, cool blue hard-edged shadows, crisp Japanese magazine-cover composition'),
  recipe('korean-blue-white', 'colorblock', '韩系蓝白', '半写实线条与高纯色块', '#3b82c4', 'Korean commercial fashion illustration, semi-realistic clean line art, high-chroma blue and white color blocking'),
  recipe('yellow-black', 'colorblock', '黄黑撞色', '明黄与纯黑的克制强对比', '#f2c500', 'yellow-and-black fashion illustration, vivid yellow against pure black, hard-edged shadows, bold restrained magazine-cover design'),
  recipe('pink-blue', 'colorblock', '粉蓝撞色', '珊瑚粉与海军蓝旅行海报感', '#e88991', 'coral-pink and navy-blue fashion illustration, deep teal midtones, Japanese travel-poster composition'),
  recipe('vintage-soft-focus', 'dream', '复古柔焦', '暖灰雾粉与褪色旧画报感', '#c69b93', 'low-saturation vintage gouache, warm gray and dusty pink, dappled sunlight, softly bleached old-magazine texture'),
  recipe('smoky-soft-focus', 'dream', '柔焦烟灰', '冷灰绿雾化与冷白逆光', '#788f88', 'smoky soft-focus illustration, misty cool gray-green background, cool-white rim light, tactile paper texture'),
  recipe('gilded-dream', 'dream', '梦幻鎏金', '金色轮廓光与深海蓝阴影', '#d7a647', 'dreamlike gilded illustration, golden rim light, deep ocean-blue shadows, elegant blue-orange contrast'),
  recipe('rainbow-dream', 'dream', '梦幻彩虹', '粉蓝紫折射与半透明材质', '#b99cdb', 'ethereal rainbow illustration, pink blue and violet prismatic refraction, high-key soft light, translucent materials'),
  recipe('neon-soft-focus', 'dream', '柔焦霓虹', '青蓝环境与暖橙粉光线', '#3da9b4', 'soft-focus neon illustration, cyan-blue ambience with warm orange-pink light, humid refraction and subtle film grain'),
  recipe('white-tulle', 'couture', '柔纱纯白', '纯白空间与流动薄纱曲线', '#e6e4df', 'high-key white couture illustration, flowing pleated tulle and organza curves, luminous white space'),
  recipe('silver-couture', 'couture', '华丽银灰', '冰蓝白、银灰与珠链水晶', '#b9c4cc', 'luxurious silver-gray couture, ice blue-white palette, sheer fabric, pearl chains, crystal and feather details'),
  recipe('black-red', 'dark', '暗调黑红', '暗酒红与猩红硬光切割', '#831f2b', 'dark black-and-burgundy fashion illustration, sharp scarlet neon light cuts, dramatic negative darkness'),
  recipe('dark-korean', 'dark', '暗黑韩系', '丰富黑灰层次与暗红点缀', '#5d3035', 'dark Korean fashion editorial, rich black and cool-gray layers, restrained dark-red accents, polished materials'),
  recipe('cold-light-dark', 'dark', '暗黑冷光', '纯黑背景，仅保留轮廓高光', '#dbe6eb', 'minimal dark illustration on pure black, isolated cool-white hard light, only essential silhouette and highlights'),
  recipe('courtyard-handpainted', 'oriental', '庭院手绘', '白墙灰瓦、绿植与斑驳树影', '#66855e', 'hand-painted Chinese courtyard, white walls, gray roof tiles, greenery and dappled shadows, watercolor-gouache texture'),
  recipe('oriental-blue-green', 'oriental', '东方青绿', '湖面远山、轻雾与禅意留白', '#4b8b80', 'oriental blue-green illustration, distant mountains reflected on water, light mist, expansive meditative negative space'),
  recipe('minimal-ink-gray', 'oriental', '极简墨灰', '月轮、倒影与诗集封面感', '#50545a', 'minimal ink-gray illustration, cool gray, warm ivory and dense ink shapes, moon disc, reflection and paper grain'),
  recipe('vintage-silhouette', 'print', '复古剪影', '米白、炭黑、暖黄三色木刻感', '#c99a3d', 'vintage silhouette print, limited ivory charcoal-black and warm-yellow palette, woodcut grain, generous negative space'),
  recipe('vintage-cinema', 'print', '复古电影', '深青、红橙与几何长投影', '#c75236', 'vintage cinema poster, deep teal, red-orange and cream blocks, geometric architecture, long shadows, screen-print texture'),
  recipe('japanese-woodblock', 'print', '日式版画', '旧纸深墨与少量鲜亮套色', '#d45d43', 'Japanese woodblock poster, aged ivory paper, deep ink subject, sparse vivid spot colors, Showa-era composition'),
  recipe('cool-summer', 'cinematic', '清冷夏日', '低机位、钴蓝天空与冷白硬光', '#357bbd', 'cool cinematic summer illustration, low-angle view, cobalt-blue sky, crisp cool-white sunlight, blue-white contrast'),
  recipe('giant-companion', 'cinematic', '童话巨宠', '巨大与渺小的静默尺度反差', '#b8aa98', 'cinematic fairy tale with a giant gentle companion, striking scale contrast, warm gray-white negative space, quiet mutual gaze'),
];

export const getStyleRecipe = (styleId: string) => STYLE_RECIPES.find((item) => item.id === styleId);

export function buildStylePrompt(subject: string, styleId: string): string {
  const cleanSubject = subject.trim();
  const selected = getStyleRecipe(styleId);
  if (!selected) return cleanSubject;
  return `${cleanSubject}. Visual style: ${selected.prompt}. Preserve the requested subject, action, identity, count and key objects exactly; do not add text, logos, watermarks or unrelated elements.`;
}
