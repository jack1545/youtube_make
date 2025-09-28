-- 创建项目表
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_id TEXT NOT NULL
);

-- 创建脚本表
CREATE TABLE scripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'editing', 'completed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建脚本分析表
CREATE TABLE script_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
  analysis TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_script_analyses_script_id ON script_analyses(script_id);
CREATE INDEX idx_script_analyses_created_at ON script_analyses(created_at);

-- 创建生成图片表
CREATE TABLE generated_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  image_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
  shot_number INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_scripts_project_id ON scripts(project_id);
CREATE INDEX idx_generated_images_script_id ON generated_images(script_id);
CREATE INDEX idx_generated_images_script_shot ON generated_images(script_id, shot_number);

-- 创建参考图表
CREATE TABLE reference_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建API Key设置表
CREATE TABLE api_key_settings (
  user_id TEXT PRIMARY KEY,
  gemini_api_key TEXT,
  doubao_api_key TEXT,
  veo3_api_key TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建生成视频表
CREATE TABLE generated_videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  script_id UUID REFERENCES scripts(id) ON DELETE SET NULL,
  image_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  video_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  shot_number INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_reference_images_user_id ON reference_images(user_id);
CREATE INDEX idx_generated_videos_user_id ON generated_videos(user_id);
CREATE INDEX idx_generated_videos_script_id ON generated_videos(script_id);
CREATE INDEX idx_generated_videos_script_shot ON generated_videos(script_id, shot_number);
