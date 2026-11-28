/** #6316: real Worker and built SPA read 250 prospects after an intervening edit, at desktop and phone widths.
 *
 * From frontend/tests/visual/README.md (moved by #6472): #6316: real Worker/SPA reads 250
 * prospects at desktop and phone widths after an edit between pages; no duplicate or skipped
 * cards.
 */
import {test,expect} from '@playwright/test';
import {prepare} from './_editor.mjs';
test('all cards remain reachable past 100 and a same-status edit between pages',async({page,request},testInfo)=>{
 const m=await prepare(page,request),project=m.oneClick.projectId;
 const headers={Authorization:`Bearer ${m.token}`};
 const csv='name,email,consent_basis,source\n'+Array.from({length:250},(_,i)=>`Paging fixture ${i},paging-${i}@example.test,none,website`).join('\n');
 const imported=await request.post('/api/grow/prospects/import',{headers,data:{project,csv}});
 expect(imported.status()).toBe(200);expect((await imported.json()).imported).toBe(250);
 const before=await request.get(`/api/grow/prospects?project=${project}&source=website&per_status=100`,{headers});
 expect(before.ok()).toBeTruthy();const unseen=(await before.json()).columns.find(c=>c.status==='new').cards[50];
 await page.setViewportSize({width:1440,height:900});
 await page.goto(`/grow/distribution/prospects?project_id=${project}`);
 await page.getByRole('button',{name:'Website sign-up',exact:true}).click();
 const column=page.getByRole('region',{name:'New',exact:true});
 await expect(column.getByTestId('prospect-card')).toHaveCount(20);
 await expect(column.getByRole('button',{name:'+230 more',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('paging-desktop.png'),fullPage:true});
 const edited=await request.patch(`/api/grow/prospects/${unseen.uid}/status`,{headers,data:{project,status:'new'}});
 expect(edited.ok()).toBeTruthy();
 await page.setViewportSize({width:390,height:844});
 // The desktop navigation remains open as a phone drawer after resizing.
 const closeMenu=page.getByRole('button',{name:'Close menu',exact:true});
 if(await closeMenu.isVisible())await closeMenu.click();
 for(let count=20;count<250;count+=20){await column.getByRole('button',{name:`+${250-count} more`,exact:true}).click();await expect(column.getByTestId('prospect-card')).toHaveCount(Math.min(250,count+20));}
 const names=await column.getByTestId('prospect-card').locator('button').allTextContents();
 expect(new Set(names).size).toBe(250);expect(names.some(name=>name.includes(unseen.name))).toBe(true);
 await expect(column.getByRole('button',{name:/^\+\d+ more$/})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('paging-phone.png'),fullPage:false});
});
