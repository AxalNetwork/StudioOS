/** #6315: built SPA confirmation, destination link and undo at desktop/phone widths; synthetic Mercury responses, no bank access. */
import {test,expect} from '@playwright/test';
import {prepare} from './_editor.mjs';
// #7247: the partner-network handler awaits `route.fetch()`; if the test ends while that request is in flight, the
// await throws "route.fetch: Test ended" and fails the next spec. Unrouting waits for running handlers and drops it.
test.afterEach(async ({page})=>{if(!page.isClosed())await page.unrouteAll({behavior:'ignoreErrors'});});
for(const width of [1440,390])test(`Mercury acceptance names its destination and offers undo at ${width}px`,async({page,request},testInfo)=>{
 const m=await prepare(page,request),project=m.oneClick.projectId;let accepted=false,accepts=0,undos=0;
 const destination={uid:'receipt',source:'mercury',source_id:9,label:'Partner network',href:`/grow/partner-network/partner-a?project_id=${project}`,created_record:true,can_undo:true};
 await page.route('**/api/cycles/grow/modules/partner-network?*',async route=>{const response=await route.fetch(),data=await response.json();
  data.parts={...data.parts,from_mercury:{state:'ok',can_decide:true,proposals:[{id:9,state:accepted?'accepted':'pending',partner_company:'Fixture partner',growth_partner_uid:accepted?'partner-a':null,growth_partner_name:accepted?'Fixture partner':null}]}};
  await route.fulfill({response,json:data});
 });
 await page.route('**/api/cycles/grow/mercury/partner-proposals/9/accept',route=>{accepts++;accepted=true;return route.fulfill({json:{ok:true,destination}});});
 await page.route('**/api/cycles/grow/proposal-receipts?*',route=>route.fulfill({json:{receipts:accepted?[destination]:[]}}));
 await page.route('**/api/cycles/grow/mercury/partner-proposals/9/undo',route=>{undos++;accepted=false;return route.fulfill({json:{ok:true}});});
 await page.setViewportSize({width,height:900});await page.goto(`/grow/partner-network?project_id=${project}`);
 await page.getByTestId('mercury-accept-9').click();expect(accepts).toBe(0);
 const dialog=page.getByRole('dialog',{name:'Add this Mercury proposal to Partner network?'});
 await expect(dialog).toContainText('Accept creates a partner named Fixture partner in Partner network');
 await page.screenshot({path:testInfo.outputPath(`confirm-${width}.png`),fullPage:false});
 await dialog.getByRole('button',{name:'Add the partner',exact:true}).click();
 const destinations=page.getByTestId('grow-proposal-destinations');
 await expect(destinations.getByRole('link',{name:'Partner network',exact:true})).toHaveAttribute('href',destination.href);
 await expect(destinations).toContainText('Undo removes the created record only while unchanged.');expect(accepts).toBe(1);
 await destinations.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`accepted-${width}.png`),fullPage:false});
 await destinations.getByRole('button',{name:'Undo',exact:true}).click();await expect(destinations.getByRole('link')).toHaveCount(0);expect(undos).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
