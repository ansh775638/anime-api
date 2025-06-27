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
};

/**
 * Dynamic search for an anime on the target site using the AniList API information
 * @param {number|string} anilistId - The AniList ID to search for
 * @returns {Promise<string|null>} - The internal ID or null if not found
 */
async function findInternalIdFromAnilist(anilistId) {
  try {
    console.log(`[AniList] Searching for anime with AniList ID: ${anilistId}`);
    
    // Get anime details from AniList API
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
    
    // Try all possible title variants
    const searchTerms = [
      animeData.title.english,
      animeData.title.romaji
    ].filter(Boolean);
    
    // Try each search term
    for (const term of searchTerms) {
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
          
          // Extract the first result (most relevant)
          const firstItem = animeItems.first();
          const title = firstItem.find('.film-detail .film-name').text().trim();
          const link = firstItem.find('.film-poster').attr('href');
          
          if (link) {
            const internalId = link.split('/').pop();
            console.log(`[AniList] Found anime: "${title}" with ID: ${internalId}`);
            
            // Store in cache for future use
            ANILIST_CACHE.set(anilistId, internalId);
            
            return internalId;
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
