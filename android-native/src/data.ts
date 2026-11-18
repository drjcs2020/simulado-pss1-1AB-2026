export type ClassId = '1A' | '1B';
export type ExamType = 'A' | 'B' | 'C';
export type Student = { num: number; name: string; type: ExamType };
export const ROSTERS: Record<ClassId, Student[]> = {
  "1A": [
    {num:1,name:"ALESSANDRO DE LIMA MAINARDES",type:"A"},{num:2,name:"ALEXSANDRO PACHECO ANDRADE",type:"B"},
    {num:3,name:"ANTHONY GABRIEL SILVA DE OLIVEIRA",type:"C"},{num:4,name:"CARLOS EDUARDO CAMARGO DA SILVA",type:"A"},
    {num:5,name:"CLEVERSON KAUAN COSTA",type:"B"},{num:6,name:"DEIVID BERNARDO DE LARA RODRIGUES",type:"C"},
    {num:7,name:"DHIENYFER APARECIDA CAMARGO VIEIRA",type:"A"},{num:8,name:"DOUGLAS DE SOUZA KOCH",type:"B"},
    {num:9,name:"GABRIEL PACHECO PINHEIRO",type:"C"},{num:10,name:"JOÃO CARLOS MARTINS BUENO",type:"A"},
    {num:11,name:"JOAO MANOEL CASTANHO MATSUMOTO",type:"B"},{num:12,name:"JOAO PEDRO AMARAL",type:"C"},
    {num:13,name:"LUIS FELIPE CARDOSO DE SOUZA",type:"A"},{num:16,name:"MILENA DE OLIVEIRA MARTINS",type:"B"},
    {num:17,name:"NÁTHALY VITÓRIA BIAZIN OLEIAS",type:"C"},{num:18,name:"PIETRO HAVI KUKI AZEVEDO E SILVA",type:"A"},
    {num:22,name:"JOAO PAULO RAMOS DOS SANTOS",type:"B"},{num:23,name:"GUSTAVO DOS SANTOS LEAL",type:"C"},
    {num:24,name:"THAIS ARRUDA LEITE",type:"A"},{num:27,name:"HANA EDUARDA DOS SANTOS MONTEIRO DE OLIVEIRA",type:"B"},
    {num:28,name:"VICTOR ENRIQUE SANTOS SILVA",type:"C"}
  ],
  "1B": [
    {num:1,name:"ANA FLAVIA SOARES DE AGOSTINHO",type:"A"},{num:2,name:"ANA LORENA TELES DINIZ",type:"B"},
    {num:3,name:"ANDERSON GABRIEL SCHINEGOWSKI CIARÁ",type:"C"},{num:4,name:"ANDREY ALVES ANDRADE",type:"A"},
    {num:5,name:"EMANUELLY DA SILVA VIEIRA",type:"B"},{num:6,name:"EMANUELY NAYARA ROBERTO DOS PASSOS",type:"C"},
    {num:7,name:"GRAZIELLY MILEK DOS SANTOS",type:"A"},{num:8,name:"GUSTAVO TOZESKI OLIVEIRA",type:"B"},
    {num:9,name:"HELENA VALENTIM GUIMARAES",type:"C"},{num:10,name:"JOAO PEDRO SOARES DA SILVA",type:"A"},
    {num:11,name:"KAREN CRISTINA BATISTA DA SILVA",type:"B"},{num:12,name:"KAUÃ HENRIQUE DOS SANTOS",type:"C"},
    {num:13,name:"LUIZ FELIPE DA ROCHA DA SILVA",type:"A"},{num:14,name:"NATHIELLY VITORIA DOS SANTOS LARA",type:"B"},
    {num:15,name:"SCHEILA SIMÕES",type:"C"},{num:16,name:"VINICIUS ROBERTO",type:"A"},
    {num:17,name:"WALACY RENAN GONÇALVES FERREIRA",type:"B"},{num:18,name:"WALESKA MARIELLY MAINARDES DE LIMA",type:"C"},
    {num:19,name:"YURI RAFAEL RAMOS DOS SANTOS",type:"A"},{num:21,name:"JULIO CESAR PILAT OLIVEIRA",type:"B"},
    {num:23,name:"MARIA EDUARDA GABRIELY DE SOUZA SBITIKOWSKI",type:"C"},{num:25,name:"FABIANA ELOA MACHADO DE OLIVEIRA",type:"A"},
    {num:26,name:"SOFIA KATARINE DE LIMA",type:"B"},{num:27,name:"LUIS RAFAEL ALBANO DE ALMEIDA",type:"C"},
    {num:28,name:"ADRIAN EMANUEL PACHECO LOURENÇO",type:"A"}
  ]
};
export const ANSWER_KEYS: Record<ExamType, number[]> = {
  A: [11, 5, 14, 11, 13, 7, 14, 11, 13, 7],
  B: [13, 3, 7, 13, 11, 14, 11, 7, 14, 13],
  C: [7, 10, 11, 7, 14, 13, 7, 13, 11, 14]
};
export const SCHOOL = 'Colégio Estadual Padre Nicolau Baltazar';
export const APP_TITLE = 'Corretor PSS 1 / UEPG — Matemática 2026';
export function lookupStudent(group: ClassId, num: number): Student | undefined {
 return ROSTERS[group].find(item => item.num === num);
}
export function parseStudentQR(value: string): {group:ClassId,num:number,type:ExamType}|null {
 const parts = value.trim().split('|');
 if(parts.length !== 4 || parts[0] !== 'PSS1') return null;
 if(parts[1] !== '1A' && parts[1] !== '1B') return null;
 const n = Number(parts[2]);
 if(!Number.isSafeInteger(n) || n < 1) return null;
 const student = lookupStudent(parts[1] as ClassId, n);
 if(!student || student.type !== parts[3]) return null;
 return {group: parts[1] as ClassId,num:n,type:student.type};
}
