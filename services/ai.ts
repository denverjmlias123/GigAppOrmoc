import { supabase } from '../lib/supabase';

interface SuggestSkillsResponse {
  skills: string[];
}

interface SuggestCategoriesResponse {
  categories: string[];
}

interface SuggestGigCategoryItem {
  category_id: string;
  name: string;
  slug: string;
  reason: string;
}

interface SuggestGigCategoryResponse {
  suggestions: SuggestGigCategoryItem[];
  proposed_new_category: string | null;
}

interface DraftBioResponse {
  drafts: string[];
}

interface PolishDescriptionResponse {
  polished_description: string;
}

// Semantic Domain Definition for Offline / Resilient AI Processing
interface SemanticDomain {
  keywords: string[];
  categories: string[];
  skills: string[];
}

const SEMANTIC_DOMAINS: SemanticDomain[] = [
  {
    keywords: [
      'code', 'coding', 'program', 'programmer', 'programming', 'developer', 'software',
      'web', 'website', 'app', 'mobile', 'frontend', 'backend', 'fullstack', 'react',
      'javascript', 'python', 'html', 'css', 'database', 'sql', 'api', 'tech', 'computer',
      'it', 'system', 'network'
    ],
    categories: [
      'Web & Mobile Development',
      'Computer Programming',
      'Software Development',
      'Tech & IT Support'
    ],
    skills: [
      'React Native',
      'Web Development',
      'Mobile App Development',
      'JavaScript',
      'Frontend Development',
      'Database Management',
      'API Integration'
    ],
  },
  {
    keywords: [
      'design', 'designer', 'logo', 'graphic', 'graphics', 'brand', 'branding', 'poster',
      'flyer', 'banner', 'illustration', 'photoshop', 'illustrator', 'figma', 'ui', 'ux',
      'layout', 'art', 'drawing'
    ],
    categories: [
      'Graphic & Digital Design',
      'Branding & Logo Design',
      'UI/UX Design',
      'Creative & Visual Arts'
    ],
    skills: [
      'Logo Design',
      'Branding',
      'Flyer & Poster Design',
      'Social Media Graphics',
      'UI/UX Design',
      'Adobe Illustrator'
    ],
  },
  {
    keywords: [
      'photo', 'photographer', 'photography', 'video', 'videographer', 'videography',
      'camera', 'shoot', 'editing', 'editor', 'filming', 'portrait', 'event photo',
      'cinematography', 'drone'
    ],
    categories: [
      'Photography & Videography',
      'Event Photo & Video',
      'Video Editing',
      'Media & Content Creation'
    ],
    skills: [
      'Event Photography',
      'Portrait Photography',
      'Video Editing',
      'Photo Retouching',
      'Product Videography'
    ],
  },
  {
    keywords: [
      'repair', 'fix', 'aircon', 'ac', 'cleaning', 'cleaner', 'appliance', 'electric',
      'electrical', 'electrician', 'wiring', 'plumb', 'plumber', 'plumbing', 'pipe',
      'carpentry', 'carpenter', 'house', 'home', 'roof', 'masonry', 'paint', 'painter'
    ],
    categories: [
      'Home Services & Repairs',
      'Appliance Repair',
      'Electrical & Wiring',
      'Plumbing Services',
      'Aircon Services'
    ],
    skills: [
      'Appliance Repair',
      'Aircon Cleaning',
      'Electrical Installation',
      'Plumbing',
      'Carpentry',
      'General Maintenance'
    ],
  },
  {
    keywords: [
      'food', 'cater', 'catering', 'cook', 'cooking', 'bake', 'baking', 'cake', 'pastry',
      'party', 'event', 'wedding', 'birthday', 'fiesta', 'meal', 'chef', 'host', 'emcee',
      'decoration', 'decor'
    ],
    categories: [
      'Events & Catering',
      'Catering & Cooking',
      'Event Coordination',
      'Cake & Pastry Baking'
    ],
    skills: [
      'Catering Services',
      'Event Coordination',
      'Food Preparation',
      'Baking & Pastries',
      'Event Decoration'
    ],
  },
  {
    keywords: [
      'write', 'writer', 'writing', 'article', 'blog', 'content', 'translat', 'translation',
      'bisaya', 'tagalog', 'english', 'proofread', 'copywrit', 'typing', 'data entry',
      'virtual assistant', 'admin assistant', 'transcription'
    ],
    categories: [
      'Writing & Translation',
      'Bisaya Translation',
      'Content Writing',
      'Administrative Support'
    ],
    skills: [
      'Content Writing',
      'Bisaya Translation',
      'English Proofreading',
      'Copywriting',
      'Virtual Assistance',
      'Data Entry'
    ],
  },
  {
    keywords: [
      'tutor', 'tutoring', 'teach', 'teacher', 'math', 'mathematics', 'science', 'english',
      'lesson', 'homework', 'exam', 'student', 'coach', 'coaching', 'academic'
    ],
    categories: [
      'Academic & Tutoring',
      'Math & Science Coaching',
      'Language Lessons',
      'Educational Support'
    ],
    skills: [
      'Math Tutoring',
      'English Tutoring',
      'Science Coaching',
      'Homework Assistance',
      'Reading Instruction'
    ],
  },
  {
    keywords: [
      'deliver', 'delivery', 'errand', 'errands', 'driver', 'courier', 'pickup', 'pabili',
      'cargo', 'transport', 'motorcycle', 'pasabuy'
    ],
    categories: [
      'Delivery & Errands',
      'Local Logistics',
      'Transport & Courier'
    ],
    skills: [
      'Local Delivery',
      'Errand Running',
      'Document Courier',
      'Pabili Services'
    ],
  },
];

function tokenize(input: string): string[] {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

function resolveOfflineCategories(text: string): string[] {
  const tokens = tokenize(text);
  const scores: { category: string; score: number }[] = [];
  const seenCats = new Set<string>();

  for (const domain of SEMANTIC_DOMAINS) {
    let matchCount = 0;
    for (const token of tokens) {
      if (domain.keywords.some((kw) => token.includes(kw) || kw.includes(token))) {
        matchCount += 1;
      }
    }

    if (matchCount > 0) {
      for (let i = 0; i < domain.categories.length; i++) {
        const cat = domain.categories[i];
        if (!seenCats.has(cat)) {
          seenCats.add(cat);
          scores.push({ category: cat, score: matchCount * 10 - i });
        }
      }
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const result = scores.map((s) => s.category).slice(0, 5);

  if (result.length >= 2) {
    return result;
  }

  // Fallback defaults for general inquiries
  const fallbacks = [
    'General Freelance Services',
    'Tech & Digital Help',
    'Home & Local Assistance',
    'Creative & Visual Services'
  ];
  for (const fb of fallbacks) {
    if (!seenCats.has(fb) && result.length < 4) {
      result.push(fb);
    }
  }
  return result;
}

function resolveOfflineSkills(text: string): string[] {
  const tokens = tokenize(text);
  const scores: { skill: string; score: number }[] = [];
  const seenSkills = new Set<string>();

  for (const domain of SEMANTIC_DOMAINS) {
    let matchCount = 0;
    for (const token of tokens) {
      if (domain.keywords.some((kw) => token.includes(kw) || kw.includes(token))) {
        matchCount += 1;
      }
    }

    if (matchCount > 0) {
      for (let i = 0; i < domain.skills.length; i++) {
        const sk = domain.skills[i];
        if (!seenSkills.has(sk)) {
          seenSkills.add(sk);
          scores.push({ skill: sk, score: matchCount * 10 - i });
        }
      }
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const result = scores.map((s) => s.skill).slice(0, 6);

  if (result.length >= 3) {
    return result;
  }

  const defaultSkills = [
    'Client Communication',
    'Task Management',
    'Problem Solving',
    'Local Service Delivery'
  ];
  for (const def of defaultSkills) {
    if (!seenSkills.has(def) && result.length < 5) {
      result.push(def);
    }
  }
  return result;
}

export const aiService = {
  /**
   * Request AI skill suggestions based on free-form work description (Freelancer).
   * Calls Edge Function 'ai-assist' with task 'suggest_skills', with seamless offline fallback.
   */
  async suggestSkills(workDescription: string): Promise<string[]> {
    const trimmed = workDescription.trim();
    if (!trimmed) {
      throw new Error('Please describe the work you do.');
    }

    // Try online Edge Function invocation first
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data, error } = await supabase.functions.invoke<SuggestSkillsResponse>('ai-assist', {
          body: {
            task: 'suggest_skills',
            work_description: trimmed,
          },
        });

        if (!error && data?.skills && data.skills.length > 0) {
          return data.skills;
        }
      }
    } catch {
      // Fall through to offline semantic engine
    }

    // High-precision offline semantic resolution
    return resolveOfflineSkills(trimmed);
  },

  /**
   * Request AI category suggestions based on what a client usually needs help with.
   * Calls Edge Function 'ai-assist' with task 'suggest_categories', with seamless offline fallback.
   */
  async suggestCategories(helpDescription: string): Promise<string[]> {
    const trimmed = helpDescription.trim();
    if (!trimmed) {
      throw new Error('Please describe the help you usually need.');
    }

    // Try online Edge Function invocation first
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data, error } = await supabase.functions.invoke<SuggestCategoriesResponse>('ai-assist', {
          body: {
            task: 'suggest_categories',
            help_description: trimmed,
          },
        });

        if (!error && data?.categories && data.categories.length > 0) {
          return data.categories;
        }
      }
    } catch {
      // Fall through to offline semantic engine
    }

    // High-precision offline semantic resolution
    return resolveOfflineCategories(trimmed);
  },

  /**
   * Request AI category suggestions for a specific gig (matches active DB categories first,
   * and only proposes ONE general new category if none fit).
   * Calls Edge Function 'ai-assist' with task 'suggest_gig_category', with seamless offline fallback.
   */
  async suggestGigCategory(params: {
    title: string;
    description?: string;
  }): Promise<SuggestGigCategoryResponse> {
    const cleanTitle = (params.title || '').trim();
    const cleanDesc = (params.description || '').trim();
    if (cleanTitle.length < 3 && cleanDesc.length < 3) {
      throw new Error('Please enter a gig title or description first.');
    }

    // Try online Edge Function invocation first
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data, error } = await supabase.functions.invoke<SuggestGigCategoryResponse>('ai-assist', {
          body: {
            task: 'suggest_gig_category',
            title: cleanTitle.slice(0, 600),
            description: cleanDesc.slice(0, 600),
          },
        });

        if (!error && data?.suggestions && data.suggestions.length > 0) {
          return {
            suggestions: data.suggestions,
            proposed_new_category: data.proposed_new_category || null,
          };
        }
      }
    } catch {
      // Fall through to offline resolver
    }

    // Offline category suggestions
    const matchedCategories = resolveOfflineCategories(`${cleanTitle} ${cleanDesc}`);
    let dbCategories: Array<{ id: string; name: string; slug: string }> = [];
    try {
      const { data } = await supabase
        .from('categories')
        .select('id, name, slug')
        .eq('is_active', true);
      if (data && data.length > 0) {
        dbCategories = data;
      }
    } catch {
      // Fallback if offline or network error
    }

    const fallbackSuggestions: SuggestGigCategoryItem[] = matchedCategories.map((cat, idx) => {
      const dbMatch = dbCategories.find(
        (c) =>
          c.name.trim().toLowerCase() === cat.trim().toLowerCase() ||
          c.slug.trim().toLowerCase() === cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      );
      return {
        category_id: dbMatch ? dbMatch.id : `cat-${idx + 1}`,
        name: dbMatch ? dbMatch.name : cat,
        slug: dbMatch ? dbMatch.slug : cat.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        reason: `Matches service keywords in your gig posting.`,
      };
    });

    return {
      suggestions: fallbackSuggestions,
      proposed_new_category: null,
    };
  },

  /**
   * Request AI bio drafts based on user's mode, skills, location, and rough notes.
   * Calls Edge Function 'ai-assist' with task 'draft_bio', with seamless offline fallback.
   */
  async draftBio(params: {
    mode?: string;
    skills?: string[];
    area?: string;
    roughBio?: string;
  }): Promise<string[]> {
    // Try online Edge Function invocation first
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data, error } = await supabase.functions.invoke<DraftBioResponse>('ai-assist', {
          body: {
            task: 'draft_bio',
            mode: params.mode || 'find_work',
            skills: params.skills || [],
            area: params.area || '',
            rough_bio: params.roughBio || '',
          },
        });

        if (!error && Array.isArray(data?.drafts) && data.drafts.length > 0) {
          return data.drafts;
        }
      }
    } catch {
      // Fall through to offline generator
    }

    const loc = params.area ? `based in ${params.area}, Ormoc City` : 'based in Ormoc City';
    const skillsList = params.skills && params.skills.length > 0 ? params.skills.slice(0, 3).join(', ') : 'local services';
    const rough = params.roughBio?.trim() ? ` ${params.roughBio.trim()}` : '';

    return [
      `Dedicated professional ${loc} offering reliable ${skillsList}.${rough}`.slice(0, 190),
      `Experienced provider ${loc} focused on quality ${skillsList} for local clients.`.slice(0, 190),
    ];
  },

  /**
   * Polish gig description for post screen with seamless offline fallback.
   * Calls Edge Function 'ai-assist' with task 'polish_gig_description'.
   */
  async polishGigDescription(description: string): Promise<string> {
    const trimmed = description.trim();
    if (!trimmed) {
      throw new Error('Description is required.');
    }

    // Try online Edge Function invocation first
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data, error } = await supabase.functions.invoke<PolishDescriptionResponse>('ai-assist', {
          body: {
            task: 'polish_gig_description',
            description: trimmed,
          },
        });

        if (!error && data?.polished_description) {
          return data.polished_description;
        }
      }
    } catch {
      // Fall through to offline polisher
    }

    // Offline structured polish
    return `Overview:\n${trimmed}\n\nDeliverables:\n- Quality work matching requirements\n- Prompt communication throughout the project.`;
  },
};
