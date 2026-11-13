// D4808 (#4808) gave a proposal's review its own address, `/admin/programs/proposals/:uid`
// (`routes/adminProgramsGeneric.jsx`). D4873 (#4873, part 3, PG04): that address is now the Proposals list with the
// review drawer open over it (`ProposalReviewSheet.jsx`), as the house detail sheet's addresses are (D1317). The
// route keeps its module; the page it draws is `ProposalsPage`.
export { default } from './ProposalsPage';
export { ProposalSpec } from './ProposalReviewSheet';
