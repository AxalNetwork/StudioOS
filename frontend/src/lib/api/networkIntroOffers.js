/** D6637: accepted-tie pickers and member-offered mirrored propositions; responses use the existing intro flow. */
import {request} from '../api.js';
export const networkIntroOffersApi={people:(after=0)=>request(`/introductions/offer-candidates?after=${encodeURIComponent(after)}`),offer:(first,second)=>request('/introductions/offers',{method:'POST',body:JSON.stringify({first_user_id:first,second_user_id:second})})};
