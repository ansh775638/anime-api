import axios from "axios";
import extractEpisodesList from "../extractors/episodeList.extractor.js";

// Direct mapping of AniList IDs to internal IDs
// This could be expanded to a database in a production environment
const ANILIST_ID_MAPPING = {
  // Highly popular anime
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
 * Get episodes by AniList ID
 * This function handles the mapping from AniList ID to internal ID
 * and fetches episodes accordingly
 */
export const getEpisodesByAnilistId = async (req, res) => {
  const { id } = req.params;
  
  console.log(`[AniList] Request received for AniList ID: ${id}`);
  
  try {
    // Check if we have a direct mapping for this AniList ID
    if (!ANILIST_ID_MAPPING[id]) {
      console.log(`[AniList] No direct mapping for AniList ID: ${id}, using AniList API`);
      
      // Fetch anime information from AniList API
      try {
        const anilistQuery = `
          query {
            Media(id: ${id}, type: ANIME) {
              id
              title {
                romaji
                english
                native
              }
            }
          }
        `;
        
        const anilistResponse = await axios.post('https://graphql.anilist.co', {
          query: anilistQuery
        });
        
        if (!anilistResponse.data?.data?.Media) {
          console.error(`[AniList] AniList API returned no data for ID: ${id}`);
          return { 
            success: false, 
            message: `No anime found with AniList ID: ${id}` 
          };
        }
        
        const animeData = anilistResponse.data.data.Media;
        console.log(`[AniList] Found anime in AniList: ${animeData.title.english || animeData.title.romaji}`);
        
        // Return a message indicating this AniList ID needs to be mapped
        return {
          success: false,
          message: `AniList ID ${id} (${animeData.title.english || animeData.title.romaji}) is not yet mapped in our system. Please contact the administrator.`
        };
      } catch (error) {
        console.error(`[AniList] Error querying AniList API:`, error);
        return {
          success: false,
          message: `Error fetching information for AniList ID: ${id}`
        };
      }
    }
    
    // Use the mapped internal ID
    const internalId = ANILIST_ID_MAPPING[id];
    console.log(`[AniList] Using internal ID mapping for AniList ID ${id}: ${internalId}`);
    
    // Fetch episodes using the internal ID
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
