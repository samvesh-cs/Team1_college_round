import re

def to_camel_case(snake_str):
    components = snake_str.split('-')
    return components[0] + ''.join(x.title() for x in components[1:])

def convert_html_to_jsx(html_file, jsx_file):
    with open(html_file, 'r', encoding='utf-8') as f:
        html = f.read()

    # Extract body content
    match = re.search(r'<body[^>]*>(.*)</body>', html, re.DOTALL | re.IGNORECASE)
    if not match:
        print("No body found")
        return
    body_content = match.group(1)

    # Remove script tags
    body_content = re.sub(r'<script[^>]*>.*?</script>', '', body_content, flags=re.DOTALL | re.IGNORECASE)

    # Convert class to className
    jsx = body_content.replace('class="', 'className="')

    # Convert SVG attributes
    attrs_to_convert = [
        'viewbox', 'stroke-linecap', 'stroke-linejoin', 'stroke-width', 'stroke-dasharray',
        'aria-labelledby', 'aria-hidden', 'aria-checked', 'aria-label'
    ]
    for attr in attrs_to_convert:
        if attr.startswith('aria-'):
            continue # aria- attributes stay the same in React
        if attr == 'viewbox':
            jsx = jsx.replace('viewbox=', 'viewBox=')
        else:
            camel_attr = to_camel_case(attr)
            jsx = jsx.replace(f'{attr}=', f'{camel_attr}=')

    # Handle inline styles
    def style_replacer(m):
        style_str = m.group(1)
        # simplistic conversion
        style_str = style_str.replace('animation-delay: -3s;', "animationDelay: '-3s'")
        style_str = style_str.replace('animation-duration: 2s;', "animationDuration: '2s'")
        style_str = style_str.replace('width: 60%;', "width: '60%'")
        return f'style={{{{{style_str}}}}}'

    jsx = re.sub(r'style="([^"]+)"', style_replacer, jsx)

    # Make empty tags self-closing for React (img, hr, br, input) - we don't have many here except some lines/polygons
    # The SVG tags like <circle ...></circle> or <circle .../> need to be handled. HTML might have <circle ...></circle>
    # Actually, standard tags are fine as long as they are closed.
    
    # Handle HTML comments
    jsx = re.sub(r'<!--(.*?)-->', r'{/* \1 */}', jsx)

    # Wrap in component
    final_jsx = f"""import React, {{ useState, useEffect }} from 'react';

export default function App() {{
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [typingEnabled, setTypingEnabled] = useState(false);
  const [intentLockEnabled, setIntentLockEnabled] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {{
    const handleMouseMove = (e) => {{
      const spotlight = document.getElementById('ambientSpotlight');
      if (spotlight) {{
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        spotlight.style.setProperty('--mouse-x', `${{x}}%`);
        spotlight.style.setProperty('--mouse-y', `${{y}}%`);
      }}
    }};
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }}, []);

  return (
    <div className="bg-[#f8fafc] text-slate-800 min-h-screen relative font-sans overflow-x-hidden selection:bg-teal-500 selection:text-white">
      {jsx}
    </div>
  );
}}
"""
    with open(jsx_file, 'w', encoding='utf-8') as f:
        f.write(final_jsx)
    print("Converted successfully")

convert_html_to_jsx('popup_screen.html', 'src/popup/App.jsx')
