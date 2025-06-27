import axios from "axios";
import * as cheerio from "cheerio";
import extractEpisodesList from "../extractors/episodeList.extractor.js";
import { v1_base_url } from "../utils/base_v1.js";

// In-memory cache for AniList ID to internal ID mappings
const ANILIST_CACHE = new Map();

// Direct mapping for highly popular anime to ensure reliability
const ANILIST_ID_MAPPING = {
  "21": "one-piece-100", // One Piece
  "1": "cowboy-bebop", // Cowboy Bebop
  "5": "naruto", // Naruto
  "16498": "attack-on-titan", // Attack on Titan
  "101922": "demon-slayer-kimetsu-no-yaiba", // Demon Slayer
  "97938": "my-hero-academia", // My Hero Academia
  "1535": "death-note", // Death Note
  "113415": "jujutsu-kaisen", // Jujutsu Kaisen
  "20": "naruto-shippuden", // Naruto Shippuden
  "15125": "tokyo-ghoul", // Tokyo Ghoul
  "99423": "dr-stone", // Dr. Stone
  "98707": "black-clover", // Black Clover
  "11757": "sword-art-online", // Sword Art Online
  "124": "fushigi-yuugi-eikoden", // Fushigi Yuugi: Eikoden (Mysterious Play: Eikoden)
};

/**
 * Dynamic search for an anime on the target site using the AniList API information
 * @param {number|string} anilistId - The AniList ID to search for
 * @returns {Promise<string|null>} - The internal ID or null if not found
 */
async function findInternalIdFromAnilist(anilistId) {
  try {
    console.log(`[AniList] Searching for anime with AniList ID: ${anilistId}`);
    
    // Get anime details from AniList API with more info
    const anilistQuery = `
      query {
        Media(id: ${anilistId}, type: ANIME) {
          id
          idMal
          title {
            romaji
            english
            native
          }
          format
          status
          synonyms
          seasonYear
          season
        }
      }
    `;
    
    const anilistResponse = await axios.post('https://graphql.anilist.co', {
      query: anilistQuery
    });
    
    if (!anilistResponse.data?.data?.Media) {
      console.error(`[AniList] AniList API returned no data for ID: ${anilistId}`);
      return null;
    }
    
    const animeData = anilistResponse.data.data.Media;
    console.log(`[AniList] Found anime in AniList: ${animeData.title.english || animeData.title.romaji}`);
    
    // Prepare all possible search terms
    const searchTerms = [
      animeData.title.english,
      animeData.title.romaji,
      ...(animeData.synonyms || [])
    ].filter(Boolean);
    
    // Add the first part of titles (for cases like "One Piece Movie 14: Stampede" -> "One Piece")
    const titleFirstParts = searchTerms
      .map(term => term?.split(':')[0]?.trim())
      .filter(term => term && term.includes(' ') && !searchTerms.includes(term));
    
    // Combine all search terms
    const allSearchTerms = [...searchTerms, ...titleFirstParts];
    
    console.log(`[AniList] Search terms: ${JSON.stringify(allSearchTerms)}`);
    
    // Try each search term
    for (const term of allSearchTerms) {
      if (!term) continue;
      
      try {
        const encodedTerm = encodeURIComponent(term);
        const searchUrl = `https://${v1_base_url}/search?keyword=${encodedTerm}`;
        
        console.log(`[AniList] Searching site with term: "${term}"`);
        const { data } = await axios.get(searchUrl);
        const $ = cheerio.load(data);
        
        const animeItems = $('.flw-item');
        const resultCount = animeItems.length;
        
        if (resultCount > 0) {
          console.log(`[AniList] Found ${resultCount} results for "${term}"`);
          
          // Extract all found titles for comparison
          const foundAnimes = [];
          animeItems.each((i, el) => {
            const title = $(el).find('.film-detail .film-name').text().trim();
            const link = $(el).find('.film-poster').attr('href');
            if (link) {
              const id = link.split('/').pop();
              foundAnimes.push({ title, id });
            }
          });
          
          console.log(`[AniList] Extracted ${foundAnimes.length} anime titles: ${JSON.stringify(foundAnimes.map(a => a.title))}`);
          
          // Try to find the best match
          for (const anime of foundAnimes) {
            if (isReasonableMatch(anime.title, term)) {
              console.log(`[AniList] Found matching anime: "${anime.title}" with ID: ${anime.id}`);
              
              // Store in cache for future use
              ANILIST_CACHE.set(anilistId, anime.id);
              
              return anime.id;
            }
          }
          
          // If no good match, just return the first result
          if (foundAnimes.length > 0) {
            console.log(`[AniList] No exact match found, using first result: "${foundAnimes[0].title}" with ID: ${foundAnimes[0].id}`);
            
            // Store in cache for future use
            ANILIST_CACHE.set(anilistId, foundAnimes[0].id);
            
            return foundAnimes[0].id;
          }
        }
      } catch (error) {
        console.error(`[AniList] Error searching for term "${term}":`, error.message);
      }
    }
    
    // If we get here, we couldn't find the anime
    console.log(`[AniList] Could not find anime for AniList ID: ${anilistId}`);
    return null;
  } catch (error) {
    console.error(`[AniList] Error in findInternalIdFromAnilist:`, error.message);
    return null;
  }
}

/**
 * Helper function to determine if two titles are a reasonable match
 * @param {string} title1 - First title
 * @param {string} title2 - Second title
 * @returns {boolean} - True if titles are a reasonable match
 */
function isReasonableMatch(title1, title2) {
  if (!title1 || !title2) return false;
  
  // Normalize titles for comparison
  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  const normalizedTitle1 = normalize(title1);
  const normalizedTitle2 = normalize(title2);
  
  // Log the comparison for debugging
  console.log(`[AniList] Comparing titles: "${title1}" vs "${title2}"`);
  console.log(`[AniList] Normalized: "${normalizedTitle1}" vs "${normalizedTitle2}"`);
  
  // Direct match
  if (normalizedTitle1 === normalizedTitle2) {
    console.log('[AniList] Direct match found');
    return true;
  }
  
  // Check if title1 contains title2 or vice versa
  if (normalizedTitle1.includes(normalizedTitle2) || normalizedTitle2.includes(normalizedTitle1)) {
    console.log('[AniList] Substring match found');
    return true;
  }
  
  // Calculate similarity score
  const longerLength = Math.max(normalizedTitle1.length, normalizedTitle2.length);
  if (longerLength === 0) return true;
  
  // Calculate Levenshtein distance
  const distance = levenshteinDistance(normalizedTitle1, normalizedTitle2);
  const similarityScore = (longerLength - distance) / longerLength;
  
  console.log(`[AniList] Similarity score: ${similarityScore}`);
  
  // Consider a match if similarity is high enough
  return similarityScore > 0.7;
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Levenshtein distance
 */
function levenshteinDistance(str1, str2) {
  const track = Array(str2.length + 1).fill(null).map(() => 
    Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i += 1) {
    track[0][i] = i;
  }
  
  for (let j = 0; j <= str2.length; j += 1) {
    track[j][0] = j;
  }
  
  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator, // substitution
      );
    }
  }
  
  return track[str2.length][str1.length];
}

/**
 * Get episodes by AniList ID
 * This function handles the mapping from AniList ID to internal ID
 * and fetches episodes accordingly
 */
export const getEpisodesByAnilistId = async (req, res) => {
  const { id } = req.params;
  
  console.log(`[AniList] Request received for AniList ID: ${id}`);
  
  try {
    let internalId = null;
    
    // Step 1: Check for direct mapping
    if (ANILIST_ID_MAPPING[id]) {
      internalId = ANILIST_ID_MAPPING[id];
      console.log(`[AniList] Using direct mapping for AniList ID ${id}: ${internalId}`);
    } 
    // Step 2: Check cache
    else if (ANILIST_CACHE.has(id)) {
      internalId = ANILIST_CACHE.get(id);
      console.log(`[AniList] Using cached mapping for AniList ID ${id}: ${internalId}`);
    } 
    // Step 3: Try to find dynamically
    else {
      internalId = await findInternalIdFromAnilist(id);
      
      if (!internalId) {
        console.log(`[AniList] Could not find internal ID for AniList ID: ${id}`);
        
        // Try to get anime info to provide a helpful error message
        try {
          const anilistQuery = `
            query {
              Media(id: ${id}, type: ANIME) {
                id
                title {
                  romaji
                  english
                }
              }
            }
          `;
          
          const anilistResponse = await axios.post('https://graphql.anilist.co', {
            query: anilistQuery
          });
          
          if (anilistResponse.data?.data?.Media) {
            const animeData = anilistResponse.data.data.Media;
            const animeTitle = animeData.title.english || animeData.title.romaji;
            
            return {
              success: false,
              message: `Could not find "${animeTitle}" (AniList ID: ${id}) on our source. This anime might not be available.`
            };
          }
        } catch (e) {
          // Ignore errors in this section, we're just trying to get a better error message
        }
        
        return {
          success: false,
          message: `Could not find anime with AniList ID: ${id} on our source. This anime might not be available.`
        };
      }
    }
    
    // Now we have an internal ID, fetch the episodes
    console.log(`[AniList] Fetching episodes for internal ID: ${internalId}`);
    const data = await extractEpisodesList(encodeURIComponent(internalId));
    
    if (!data || (Array.isArray(data) && data.length === 0) || 
        (typeof data === 'object' && Object.keys(data).length === 0)) {
      console.error(`[AniList] No episodes found for internal ID: ${internalId}`);
      return {
        success: false,
        message: `Episodes not found for AniList ID: ${id} (mapped to internal ID: ${internalId})`
      };
    }
    
    console.log(`[AniList] Successfully fetched episodes for internal ID: ${internalId}`);
    console.log(`[AniList] Episode count: ${data.totalEpisodes || 'unknown'}`);
    
    // Add the AniList ID to the response
    data.anilistId = parseInt(id);
    
    return {
      success: true,
      results: data
    };
  } catch (error) {
    console.error(`[AniList] Error:`, error);
    return {
      success: false,
      message: error.message || "An error occurred while fetching episodes"
    };
  }
}; 
