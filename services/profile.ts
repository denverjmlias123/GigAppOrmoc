import { supabase } from '../lib/supabase';
import { runOnce } from '../lib/singleFlight';
import { Profile } from './auth';
import { pickImagesUniversal, resolveImageFormat } from '../utils/imageUpload';

let portfolioUploadSeq = 0;

export interface Category {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
}

export interface Skill {
  id: string;
  name: string;
  category_id: string | null;
  is_active: boolean;
  source?: string;
  created_at: string;
}

export interface Area {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface PortfolioItem {
  id: string;
  profile_id: string;
  title: string;
  description: string;
  file_paths: string[];
  created_at: string;
}

export interface CompletenessMissingItem {
  key:
    | 'photo'
    | 'display_name'
    | 'headline'
    | 'bio'
    | 'area'
    | 'skills'
    | 'work_availability'
    | 'client_type'
    | 'hiring_interests';
  label: string;
}

export interface ProfileCompleteness {
  profile_id: string;
  role: 'find_work' | 'hire';
  percent: number;
  complete: boolean;
  missing_items: CompletenessMissingItem[];
  has_portfolio_bonus: boolean;
}

interface UpdateProfileDetailsParams {
  displayName: string;
  headline?: string;
  bio?: string;
  area?: string;
  preferredContact?: string;
  languages?: string[];
  phone?: string;
  workTypes?: string[];
  availability?: 'available_now' | 'part_time' | 'weekends' | 'not_taking_work' | '' | null;
  experienceYears?: 'lt_1' | '1_3' | '3_5' | '5_plus' | '' | null;
  startingRateNote?: string;
  clientType?: 'individual' | 'business' | 'organization' | 'other' | '' | null;
  businessName?: string;
  aboutHiring?: string;
}

interface SaveHiringDetailsParams {
  clientType?: 'individual' | 'business' | 'organization' | 'other' | '' | null;
  businessName?: string;
  aboutHiring?: string;
  categoryIds?: string[];
  customCategoryNames?: string[];
}

interface SaveHiringDetailsResult {
  profile_id: string;
  client_type: 'individual' | 'business' | 'organization' | 'other' | null;
  business_name: string;
  about_hiring: string;
  hiring_interests: Category[];
}

export interface PublicProfileData {
  profile: Profile;
  skills: Skill[];
  portfolioItems: PortfolioItem[];
  hiringInterests: Category[];
  gigsPostedCount: number;
  completeness?: ProfileCompleteness | null;
}

export interface FreelancerSummary {
  id: string;
  display_name: string;
  headline: string | null;
  bio: string | null;
  avatar_path: string | null;
  area: string | null;
  availability: 'available_now' | 'part_time' | 'weekends' | 'not_taking_work' | null;
  experience_years: 'lt_1' | '1_3' | '3_5' | '5_plus' | null;
  work_types: string[];
  freelancer_rating_avg: number;
  freelancer_rating_count: number;
  freelancer_completed_gigs: number;
  skills: string[];
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);

function validateImageFile(params: {
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}): { valid: boolean; ext: string; mimeType: string; error?: string } {
  const { mimeType, fileName, fileSize } = params;

  if (typeof fileSize === 'number' && fileSize > MAX_IMAGE_BYTES) {
    return {
      valid: false,
      ext: 'jpg',
      mimeType: 'image/jpeg',
      error: 'Image is too large. Maximum allowed file size is 5 MB.',
    };
  }

  // Reject explicit non-image MIME types (e.g., application/pdf, video/mp4, text/plain)
  if (
    mimeType &&
    mimeType.trim() !== '' &&
    !mimeType.trim().toLowerCase().startsWith('image/')
  ) {
    return {
      valid: false,
      ext: 'bin',
      mimeType: mimeType.trim().toLowerCase(),
      error: 'Unsupported file format. Please choose a JPEG, PNG, or WebP image.',
    };
  }

  const resolved = resolveImageFormat({
    mimeType,
    fileName,
    uri: fileName,
  });

  const ext = resolved.ext === 'jpeg' ? 'jpg' : resolved.ext;
  const normalizedMime = resolved.mimeType === 'image/jpg' ? 'image/jpeg' : resolved.mimeType;

  if (!ALLOWED_IMAGE_EXTS.has(ext) || !ALLOWED_IMAGE_MIMES.has(normalizedMime)) {
    return {
      valid: false,
      ext,
      mimeType: normalizedMime,
      error: 'Unsupported file format. Please choose a JPEG, PNG, or WebP image.',
    };
  }

  return {
    valid: true,
    ext,
    mimeType: normalizedMime,
  };
}

function extractStorageObjectPath(
  bucket: 'avatars' | 'portfolio',
  urlOrPath: string | null | undefined
): string | null {
  if (!urlOrPath) return null;
  const trimmed = urlOrPath.trim();
  if (!trimmed) return null;

  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = trimmed.indexOf(marker);
  if (idx !== -1) {
    return decodeURIComponent(trimmed.slice(idx + marker.length).split('?')[0]);
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }
  return null;
}

function buildAvatarStoragePath(userId: string, timestamp: number = Date.now(), ext: string = 'jpg'): string {
  const cleanExt = ext === 'jpeg' ? 'jpg' : ext.toLowerCase();
  return `${userId}/avatar-${timestamp}.${cleanExt}`;
}

export function validateSkillName(rawName: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = (rawName || '').replace(/\s+/g, ' ').trim();
  if (normalized.length < 2 || normalized.length > 40) {
    return {
      valid: false,
      normalized,
      error: 'Skill name must be between 2 and 40 characters.',
    };
  }
  if (normalized.includes('@')) {
    return {
      valid: false,
      normalized,
      error: 'Skill name cannot contain an email address.',
    };
  }
  if (/(https?:\/\/|www\.|\.[a-z]{2,4}\/|\.(com|net|org|ph|io)\b)/i.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Skill name cannot contain a website or URL.',
    };
  }
  if (normalized.replace(/[^0-9]/g, '').length >= 7) {
    return {
      valid: false,
      normalized,
      error: 'Skill name cannot contain a phone number.',
    };
  }
  if (!/[A-Za-z]/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Skill name must include letters.',
    };
  }
  if (!/^[A-Za-z0-9 &+\-./]+$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Skill name may only contain letters, numbers, spaces, and & - + . /.',
    };
  }
  if (
    /\b(fuck|shit|bitch|asshole|puta|putangina|gago|tarantado|ulol|bobo|scam|scammer|porn|sex|shabu)\b/i.test(
      normalized
    )
  ) {
    return {
      valid: false,
      normalized,
      error: 'Skill name contains inappropriate language.',
    };
  }
  return { valid: true, normalized };
}

export const profileService = {
  validateImageFile,
  extractStorageObjectPath,
  buildAvatarStoragePath,
  validateSkillName,

  async getCategories(): Promise<Category[]> {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (!error && data && data.length > 0) return data as Category[];
      const rpcResult = await supabase.rpc('get_browse_categories');
      if (rpcResult.data && (rpcResult.data as any[]).length > 0) {
        return (rpcResult.data as any[]).map((row) => ({
          id: String(row.id),
          name: String(row.name),
          slug: String(row.slug),
          is_active: Boolean(row.is_active),
          created_at: String(row.created_at || ''),
        }));
      }
      return (data || []) as Category[];
    } catch {
      try {
        const { data } = await supabase.rpc('get_browse_categories');
        return ((data as any[]) || []).map((row) => ({
          id: String(row.id),
          name: String(row.name),
          slug: String(row.slug),
          is_active: Boolean(row.is_active),
          created_at: String(row.created_at || ''),
        }));
      } catch {
        return [];
      }
    }
  },

  async getSkills(categoryId?: string): Promise<Skill[]> {
    let query = supabase
      .from('skills')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    try {
      const { data, error } = await query;
      if (!error && data && data.length > 0) return data as Skill[];
    } catch {
      // Fallback below
    }
    return [];
  },

  async getAreas(): Promise<Area[]> {
    try {
      const { data, error } = await supabase
        .from('areas')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (!error && data && data.length > 0) {
        return (data || []).map((row: any) => ({
          id: row.id,
          name: row.name,
          is_active: Boolean(row.is_active),
          created_at: String(row.created_at || ''),
        }));
      }
    } catch {
      // Fallback to default Ormoc barangays below
    }

    return [
      { id: 'cogon', name: 'Cogon', is_active: true, created_at: '' },
      { id: 'valencia', name: 'Valencia', is_active: true, created_at: '' },
      { id: 'linao', name: 'Linao', is_active: true, created_at: '' },
      { id: 'can-adieng', name: 'Can-adieng', is_active: true, created_at: '' },
      { id: 'ipil', name: 'Ipil', is_active: true, created_at: '' },
      { id: 'san-pablo', name: 'San Pablo', is_active: true, created_at: '' },
      { id: 'tambulilid', name: 'Tambulilid', is_active: true, created_at: '' },
      { id: 'mabini', name: 'Mabini', is_active: true, created_at: '' },
      { id: 'camp-downes', name: 'Camp Downes', is_active: true, created_at: '' },
      { id: 'alegria', name: 'Alegria', is_active: true, created_at: '' },
      { id: 'bantigue', name: 'Bantigue', is_active: true, created_at: '' },
      { id: 'curva', name: 'Curva', is_active: true, created_at: '' },
      { id: 'district-1', name: 'District 1', is_active: true, created_at: '' },
      { id: 'district-2', name: 'District 2', is_active: true, created_at: '' },
      { id: 'district-3', name: 'District 3', is_active: true, created_at: '' },
      { id: 'district-4', name: 'District 4', is_active: true, created_at: '' },
    ];
  },

  async getProfileCompleteness(profileId: string): Promise<ProfileCompleteness> {
    try {
      const { data, error } = await supabase.rpc('get_profile_completeness', {
        p_profile_id: profileId,
      });

      if (!error && data && typeof data === 'object') {
        const raw: any = data;
        let percent = Number(raw.percent ?? raw.percentage ?? raw.score ?? 0);
        let complete = Boolean(raw.complete ?? raw.is_complete ?? (percent >= 100));
        let missing_items: CompletenessMissingItem[] = Array.isArray(raw.missing_items)
          ? raw.missing_items
          : [];

        // If RPC didn't provide missing_items, compute them accurately from profile details
        if (missing_items.length === 0 && !complete) {
          const { data: p } = await supabase
            .from('profiles')
            .select('avatar_path, display_name, bio, area, active_mode, client_type, headline')
            .eq('id', profileId)
            .maybeSingle();

          if (p) {
            const isHire = p.active_mode === 'hire' || p.active_mode === 'client';
            if (!p.avatar_path) {
              missing_items.push({ key: 'photo', label: 'Add a profile photo' });
            }
            if (!p.display_name || p.display_name.trim().length < 2) {
              missing_items.push({ key: 'display_name', label: 'Add your display name' });
            }
            if (!p.bio || p.bio.trim().length < 20) {
              missing_items.push({ key: 'bio', label: 'Write a bio (at least 20 characters)' });
            }
            if (!p.area || p.area.trim().length < 2) {
              missing_items.push({ key: 'area', label: 'Add your barangay or area' });
            }
            if (isHire) {
              if (!p.client_type) {
                missing_items.push({ key: 'client_type', label: 'Select your client type' });
              }
            } else {
              if (!p.headline) {
                missing_items.push({ key: 'headline', label: 'Add a professional headline' });
              }
            }
            const totalItems = 5;
            const completedCount = totalItems - missing_items.length;
            if (raw.percent === undefined && raw.percentage === undefined && raw.score === undefined) {
              percent = Math.round((completedCount / totalItems) * 100);
              complete = percent >= 100;
            }
          }
        }

        return {
          profile_id: profileId,
          role: raw.role ?? 'hire',
          percent,
          complete,
          missing_items,
          has_portfolio_bonus: Boolean(raw.has_portfolio_bonus),
        };
      }
    } catch {
      // Fall through to fallback computation
    }

    // Direct fallback if RPC fails
    try {
      const { data: p } = await supabase
        .from('profiles')
        .select('avatar_path, display_name, bio, area, active_mode, client_type, headline')
        .eq('id', profileId)
        .maybeSingle();

      if (p) {
        const isHire = p.active_mode === 'hire' || p.active_mode === 'client';
        const missing_items: CompletenessMissingItem[] = [];
        if (!p.avatar_path) missing_items.push({ key: 'photo', label: 'Add a profile photo' });
        if (!p.display_name || p.display_name.trim().length < 2) missing_items.push({ key: 'display_name', label: 'Add your display name' });
        if (!p.bio || p.bio.trim().length < 20) missing_items.push({ key: 'bio', label: 'Write a bio (at least 20 characters)' });
        if (!p.area || p.area.trim().length < 2) missing_items.push({ key: 'area', label: 'Add your barangay or area' });
        if (isHire && !p.client_type) missing_items.push({ key: 'client_type', label: 'Select your client type' });
        if (!isHire && !p.headline) missing_items.push({ key: 'headline', label: 'Add a professional headline' });

        const totalItems = 5;
        const percent = Math.round(((totalItems - missing_items.length) / totalItems) * 100);
        return {
          profile_id: profileId,
          role: isHire ? 'hire' : 'find_work',
          percent,
          complete: percent >= 100,
          missing_items,
          has_portfolio_bonus: false,
        };
      }
    } catch {}

    return {
      profile_id: profileId,
      role: 'hire',
      percent: 0,
      complete: false,
      missing_items: [],
      has_portfolio_bonus: false,
    };
  },

  async getOwnPrivatePhone(userId: string): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('profile_private')
        .select('phone')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data?.phone) return data.phone;
    } catch {}

    try {
      const { data } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', userId)
        .maybeSingle();

      if (data?.phone) return data.phone;
    } catch {}

    return '';
  },

  async updateProfileDetails(params: UpdateProfileDetailsParams): Promise<Profile> {
    return runOnce('update_profile_details', async () => {
      const { data, error } = await supabase.rpc('update_profile_details', {
        p_display_name: params.displayName,
        p_headline: params.headline ?? null,
        p_bio: params.bio ?? null,
        p_area: params.area ?? null,
        p_preferred_contact: params.preferredContact ?? null,
        p_languages: params.languages ?? null,
        p_phone: params.phone ?? null,
        p_work_types: params.workTypes ?? null,
        p_availability: params.availability ?? null,
        p_experience_years: params.experienceYears ?? null,
        p_starting_rate_note: params.startingRateNote ?? null,
        p_client_type: params.clientType ?? null,
        p_business_name: params.businessName ?? null,
        p_about_hiring: params.aboutHiring ?? null,
      });

      if (error) throw error;
      return data as Profile;
    });
  },

  async addProfileSkills(skillIds: string[], customNames: string[]): Promise<Skill[]> {
    return runOnce('add_profile_skills', async () => {
      const { data, error } = await supabase.rpc('add_profile_skills', {
        p_skill_ids: skillIds,
        p_custom_names: customNames,
      });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.out_skill_id || row.skill_id,
        name: row.out_skill_name || row.skill_name || row.name,
        category_id: null,
        is_active: row.out_is_active ?? row.is_active,
        source: row.out_source || row.source,
        created_at: new Date().toISOString(),
      }));
    });
  },

  async getUserSkills(profileId: string): Promise<Skill[]> {
    try {
      const { data, error } = await supabase
        .from('profile_skills')
        .select(`
          skill_id,
          skills (
            id,
            name,
            category_id,
            is_active,
            source,
            created_at
          )
        `)
        .eq('profile_id', profileId);

      if (!error && data) {
        const list: Skill[] = [];
        (data || []).forEach((row: any) => {
          if (row.skills) {
            list.push(row.skills as Skill);
          }
        });
        return list.sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch {}

    try {
      const { data } = await supabase
        .from('user_skills')
        .select('skill_id, skill_name, created_at')
        .eq('user_id', profileId);

      if (data && data.length > 0) {
        return data.map((r: any) => ({
          id: r.skill_id,
          name: r.skill_name || 'Skill',
          category_id: null,
          is_active: true,
          source: 'user',
          created_at: r.created_at || '',
        })).sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch {}

    return [];
  },

  async addUserSkill(_profileId: string, skillId: string): Promise<void> {
    await profileService.addProfileSkills([skillId], []);
  },

  async removeUserSkill(_profileId: string, skillId: string): Promise<void> {
    return runOnce(`remove_profile_skill:${skillId}`, async () => {
      const { error } = await supabase.rpc('remove_profile_skill', {
        p_skill_id: skillId,
      });

      if (error) throw error;
    });
  },

  async getUserHiringInterests(profileId: string): Promise<Category[]> {
    try {
      const { data, error } = await supabase
        .from('profile_hiring_interests')
        .select(`
          category_id,
          categories (
            id,
            name,
            slug,
            is_active,
            created_at
          )
        `)
        .eq('profile_id', profileId);

      if (!error && data) {
        const list: Category[] = [];
        (data || []).forEach((row: any) => {
          if (row.categories) {
            list.push(row.categories as Category);
          }
        });
        return list;
      }
    } catch (e) {
      console.warn('getUserHiringInterests query error, falling back:', e);
    }

    try {
      const { data } = await supabase
        .from('profiles')
        .select('hiring_interests')
        .eq('id', profileId)
        .maybeSingle();

      if (data && Array.isArray(data.hiring_interests)) {
        return data.hiring_interests.map((name: string) => ({
          id: name,
          name: name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          is_active: true,
          created_at: new Date().toISOString(),
        }));
      }
    } catch {}

    return [];
  },

  async saveHiringDetails(params: SaveHiringDetailsParams): Promise<SaveHiringDetailsResult> {
    return runOnce('save_hiring_details', async () => {
      const { data, error } = await supabase.rpc('save_hiring_details', {
        p_client_type: params.clientType ?? null,
        p_business_name: params.businessName ?? null,
        p_about_hiring: params.aboutHiring ?? null,
        p_category_ids: params.categoryIds ?? null,
        p_custom_category_names: params.customCategoryNames ?? null,
      });

      if (error) throw error;
      return data as SaveHiringDetailsResult;
    });
  },

  async getClientPostedGigsCount(profileId: string): Promise<number> {
    const { count, error } = await supabase
      .from('gigs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', profileId)
      .neq('status', 'draft');

    if (error) return 0;
    return count || 0;
  },

  async getPortfolioItems(profileId: string): Promise<PortfolioItem[]> {
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as PortfolioItem[];
  },

  async addPortfolioItem(params: {
    profileId: string;
    title: string;
    description?: string;
    filePaths?: string[];
  }): Promise<PortfolioItem> {
    return runOnce(`add_portfolio_item:${params.profileId}:${params.title.trim().toLowerCase()}`, async () => {
      const { data, error } = await supabase
        .from('portfolio_items')
        .insert({
          profile_id: params.profileId,
          title: params.title,
          description: params.description || '',
          file_paths: params.filePaths || [],
        })
        .select()
        .single();

      if (error) throw error;
      return data as PortfolioItem;
    });
  },

  async deletePortfolioItem(id: string, profileId: string): Promise<void> {
    return runOnce(`delete_portfolio_item:${id}`, async () => {
      const { error } = await supabase
        .from('portfolio_items')
        .delete()
        .eq('id', id)
        .eq('profile_id', profileId);

      if (error) throw error;
    });
  },

  async uploadAvatar(
    userId: string,
    fileData: Blob | ArrayBuffer | Uint8Array,
    fileExt: string = 'jpg',
    mimeType?: string
  ): Promise<string> {
    return runOnce(`upload_avatar:${userId}`, async () => {
      const byteLength =
        fileData instanceof Blob
          ? fileData.size
          : fileData instanceof ArrayBuffer
          ? fileData.byteLength
          : fileData.byteLength;

      const validation = validateImageFile({
        mimeType: mimeType || `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`,
        fileName: `avatar.${fileExt}`,
        fileSize: byteLength,
      });

      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const path = buildAvatarStoragePath(userId, Date.now(), validation.ext);

      // On web browser, ensure Blob is used if possible for cleanest multipart/form-data upload
      let uploadPayload: any = fileData;
      if (typeof Blob !== 'undefined' && !(fileData instanceof Blob)) {
        try {
          uploadPayload = new Blob([fileData as any], { type: validation.mimeType });
        } catch {
          uploadPayload = fileData;
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, uploadPayload, {
          upsert: true,
          contentType: validation.mimeType,
        });

      // A failed upload never changes the profile
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      const publicUrl = publicUrlData.publicUrl;

      // Update profile avatar_path via RPC (returns previous_avatar_path)
      let rpcResult: any = null;
      const { data, error: rpcError } = await supabase.rpc('set_profile_avatar', {
        p_avatar_path: publicUrl,
      });

      if (rpcError) {
        // Fallback: update profile table directly
        const { error: directError } = await supabase
          .from('profiles')
          .update({
            avatar_path: publicUrl,
            avatar_url: publicUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (directError) {
          // Clean up newly uploaded object if DB update failed
          await supabase.storage.from('avatars').remove([path]).catch(() => {});
          throw rpcError || directError;
        }
      } else {
        rpcResult = data;
      }

      // Delete previous avatar object from storage if one existed
      const prevPath = extractStorageObjectPath('avatars', rpcResult?.previous_avatar_path);
      if (prevPath && prevPath !== path && prevPath.startsWith(`${userId}/`)) {
        await supabase.storage.from('avatars').remove([prevPath]).catch(() => {});
      }

      return publicUrl;
    });
  },

  async removeAvatar(userId: string): Promise<void> {
    return runOnce(`remove_avatar:${userId}`, async () => {
      let rpcResult: any = null;
      const { data, error: rpcError } = await supabase.rpc('set_profile_avatar', {
        p_avatar_path: null,
      });

      if (rpcError) {
        const { error: directError } = await supabase
          .from('profiles')
          .update({
            avatar_path: null,
            avatar_url: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (directError) throw rpcError || directError;
      } else {
        rpcResult = data;
      }

      const prevPath = extractStorageObjectPath('avatars', rpcResult?.previous_avatar_path);
      if (prevPath && prevPath.startsWith(`${userId}/`)) {
        await supabase.storage.from('avatars').remove([prevPath]).catch(() => {});
      }
    });
  },

  async pickAndUploadAvatar(userId: string, source: 'library' | 'camera'): Promise<string | null> {
    const picked = await pickImagesUniversal({
      source,
      allowsMultipleSelection: false,
      cropSquare: true,
      maxDimension: 1024,
      quality: 0.85,
    });

    if (!picked || picked.length === 0) {
      return null;
    }

    const file = picked[0];
    const check = validateImageFile({
      mimeType: file.mimeType,
      fileName: file.fileName,
      fileSize: file.size,
    });

    if (!check.valid) {
      throw new Error(check.error);
    }

    if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Image is too large. Maximum allowed file size is 5 MB.');
    }

    return await profileService.uploadAvatar(userId, file.bytes, check.ext, check.mimeType);
  },

  async uploadPortfolioImage(
    userId: string,
    fileData: Blob | ArrayBuffer | Uint8Array,
    fileExt: string = 'jpg',
    mimeType?: string
  ): Promise<string> {
    const byteLength =
      fileData instanceof Blob
        ? fileData.size
        : fileData instanceof ArrayBuffer
        ? fileData.byteLength
        : fileData.byteLength;

    const validation = validateImageFile({
      mimeType: mimeType || `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`,
      fileName: `item.${fileExt}`,
      fileSize: byteLength,
    });

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    portfolioUploadSeq += 1;
    const path = `${userId}/item-${Date.now()}-${portfolioUploadSeq}.${validation.ext}`;
    const { error: uploadError } = await supabase.storage
      .from('portfolio')
      .upload(path, fileData, {
        upsert: false,
        contentType: validation.mimeType,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from('portfolio')
      .getPublicUrl(path);

    return publicUrlData.publicUrl;
  },

  async pickAndUploadPortfolioImages(userId: string, maxSelection: number = 3): Promise<string[]> {
    const picked = await pickImagesUniversal({
      source: 'library',
      allowsMultipleSelection: true,
      selectionLimit: maxSelection,
      cropSquare: false,
      maxDimension: 1600,
      quality: 0.85,
    });

    if (!picked || picked.length === 0) {
      return [];
    }

    const uploadedUrls: string[] = [];
    for (const file of picked.slice(0, maxSelection)) {
      const check = validateImageFile({
        mimeType: file.mimeType,
        fileName: file.fileName,
        fileSize: file.size,
      });

      if (!check.valid) {
        throw new Error(check.error);
      }

      if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('One of the selected images exceeds the 5 MB limit.');
      }

      const url = await profileService.uploadPortfolioImage(
        userId,
        file.bytes,
        check.ext,
        check.mimeType
      );
      uploadedUrls.push(url);
    }

    return uploadedUrls;
  },

  async getPublicProfile(profileId: string): Promise<PublicProfileData | null> {
    // Read only from public.profiles - NEVER touches profile_private (dob or phone)
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, display_name, headline, bio, avatar_path, area, preferred_contact, languages, work_types, availability, experience_years, starting_rate_note, client_type, business_name, about_hiring, active_mode, mode_changed_at, onboarding_complete, freelancer_rating_avg, freelancer_rating_count, client_rating_avg, client_rating_count, freelancer_completed_gigs, client_completed_gigs, status, created_at'
      )
      .eq('id', profileId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profileData) return null;

    const isHire = profileData.active_mode === 'hire';

    const [skills, portfolioItems, hiringInterests, gigsPostedCount, completeness] =
      await Promise.all([
        isHire ? Promise.resolve([]) : profileService.getUserSkills(profileId),
        isHire ? Promise.resolve([]) : profileService.getPortfolioItems(profileId),
        profileService.getUserHiringInterests(profileId),
        profileService.getClientPostedGigsCount(profileId),
        profileService.getProfileCompleteness(profileId),
      ]);

    return {
      profile: profileData as Profile,
      skills,
      portfolioItems,
      hiringInterests,
      gigsPostedCount,
      completeness,
    };
  },

  async getTopFreelancers(params?: {
    limit?: number;
    searchQuery?: string;
    categoryId?: string;
  }): Promise<FreelancerSummary[]> {
    const limit = params?.limit ?? 10;
    let query = supabase
      .from('profiles')
      .select(
        'id, display_name, headline, bio, avatar_path, area, availability, experience_years, work_types, freelancer_rating_avg, freelancer_rating_count, freelancer_completed_gigs, active_mode, status'
      )
      .eq('status', 'active')
      .neq('active_mode', 'hire');

    if (params?.searchQuery && params.searchQuery.trim()) {
      const clean = params.searchQuery.trim().replace(/[%_]/g, '');
      if (clean) {
        query = query.or(`display_name.ilike.%${clean}%,headline.ilike.%${clean}%,bio.ilike.%${clean}%`);
      }
    }

    query = query
      .order('freelancer_rating_avg', { ascending: false, nullsFirst: false })
      .order('freelancer_completed_gigs', { ascending: false })
      .limit(limit * 2);

    const { data: profilesData, error: profilesError } = await query;
    if (profilesError) throw profilesError;
    if (!profilesData || profilesData.length === 0) return [];

    const profileIds = profilesData.map((p: any) => p.id);
    const skillMap: Record<string, string[]> = {};
    let categoryMatchSet: Set<string> | null = null;

    if (profileIds.length > 0) {
      const { data: skillsData, error: skillsError } = await supabase
        .from('profile_skills')
        .select(`
          profile_id,
          skills (
            id,
            name,
            category_id
          )
        `)
        .in('profile_id', profileIds);

      if (!skillsError && skillsData) {
        if (params?.categoryId) {
          categoryMatchSet = new Set<string>();
        }
        for (const row of skillsData as any[]) {
          const s = row.skills;
          if (!s) continue;
          if (!skillMap[row.profile_id]) {
            skillMap[row.profile_id] = [];
          }
          if (s.name) {
            skillMap[row.profile_id].push(s.name);
          }
          if (params?.categoryId && s.category_id === params.categoryId) {
            categoryMatchSet?.add(row.profile_id);
          }
        }
      }
    }

    let filtered = profilesData;
    if (categoryMatchSet !== null) {
      filtered = filtered.filter((p: any) => categoryMatchSet!.has(p.id));
    }

    return filtered.slice(0, limit).map((p: any) => ({
      id: p.id,
      display_name: p.display_name || 'Ormoc Freelancer',
      headline: p.headline || null,
      bio: p.bio || null,
      avatar_path: p.avatar_path || null,
      area: p.area || 'Ormoc City',
      availability: p.availability || null,
      experience_years: p.experience_years || null,
      work_types: Array.isArray(p.work_types) ? p.work_types : [],
      freelancer_rating_avg: Number(p.freelancer_rating_avg || 0),
      freelancer_rating_count: Number(p.freelancer_rating_count || 0),
      freelancer_completed_gigs: Number(p.freelancer_completed_gigs || 0),
      skills: skillMap[p.id] || [],
    }));
  },
};
