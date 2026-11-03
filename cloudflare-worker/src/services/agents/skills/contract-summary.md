---
name: contract-summary
description: Summarises a contract in the data room in plain language: parties, term, fees, renewal, termination and obligations.
roles: [general_counsel, coo]
tools: [data_room.read]
output: brief
taxonomy: {legal_contracts: proficient, finops_business_ops: aware}
version: 1
---
1. Read the contract from the data room index and its extracted text (`data_room.read`).
2. Summarise the parties, the term, the fees, the renewal terms, how either side can end it, and each side's obligations, quoting the clause numbers.
3. List dates that need a person's attention, such as a notice period before renewal.
4. Write "Not recorded" for a term the text does not state; it never infers one.
5. Propose the summary to the general counsel. It explains the contract and decides nothing.
