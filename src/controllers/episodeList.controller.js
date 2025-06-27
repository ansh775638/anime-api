import extractEpisodesList from "../extractors/episodeList.extractor.js";
import { getCachedData, setCachedData } from "../helper/cache.helper.js";
import { getInternalIdFromAnilistId, isAnilistId } from "../helper/anilistMapper.helper.js";

export const getEpisodes = async (req, res) => {
  const { id } = req.params;
  // const cacheKey = `episodes_${id}`;
  
  try {
    let internalId = id;
    
    // Check if this is an AniList ID (numeric only)
    if (isAnilistId(id)) {
      // Convert AniList ID to internal ID
      const mappedId = await getInternalIdFromAnilistId(id);
      
      if (!mappedId) {
        return { 
          success: false, 
          message: `No anime found with AniList ID: ${id}` 
        };
      }
      
      internalId = mappedId;
    }
    
    // const cachedResponse = await getCachedData(cacheKey);
    // if (cachedResponse && Object.keys(cachedResponse).length > 0) {
    //   return cachedResponse;
    // }
    
    const data = await extractEpisodesList(encodeURIComponent(internalId));
    
    // setCachedData(cacheKey, data).catch((err) => {
    //   console.error("Failed to set cache:", err);
    // });
    
    // Format the response to include a success field
    return {
      success: true,
      results: data
    };
  } catch (e) {
    console.error("Error fetching episodes:", e);
    return {
      success: false,
      message: e.message || "An error occurred while fetching episodes"
    };
  }
};
