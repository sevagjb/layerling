const fs=require('fs');
const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,BorderStyle,ShadingType,AlignmentType,HeadingLevel}=require('docx');
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const FONT={ascii:"Arial",hAnsi:"Arial",cs:"Arial"},LRI='⁦',PDI='⁩';
const iso=s=>s.replace(/(\{\{ui:[^}]+\}\}|\{[A-Za-z0-9_]+\}|`[^`]+`)/g,LRI+'$1'+PDI);
const bd={style:BorderStyle.SINGLE,size:4,color:"D9CBB3"},borders={top:bd,bottom:bd,left:bd,right:bd};
const W=[5100,5100];
const cell=(w,p,fill)=>new TableCell({width:{size:w,type:WidthType.DXA},borders,shading:fill?{type:ShadingType.CLEAR,fill}:undefined,margins:{top:70,bottom:70,left:110,right:110},children:p});
const en=(t,o={})=>new Paragraph({spacing:{after:40},children:[new TextRun({text:t,font:"Calibri",size:o.size||20,bold:o.bold,color:o.color||"404040"})]});
const ar=(t,o={})=>new Paragraph({bidirectional:true,alignment:AlignmentType.START,spacing:{after:40},children:[new TextRun({text:iso(t),font:FONT,rightToLeft:true,size:o.size||22,sizeComplexScript:o.size||22,bold:o.bold,boldComplexScript:o.bold,color:o.color||"1F4FBF"})]});
const body=[new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun({text:data.title,font:"Calibri"})]}),
 en(data.intro,{size:19,color:"7A6650"}),new Paragraph({children:[]})];
for(const sec of data.sections){
  body.push(new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:240,after:120},children:[new TextRun({text:sec.title,font:"Calibri"})]}));
  const rows=[new TableRow({tableHeader:true,children:[cell(W[0],[en('English',{bold:true,color:"231A11"})],"F2F2F2"),cell(W[1],[ar('العربية (مقترح)',{bold:true,color:"231A11"})],"EAF1FB")]})];
  for(const r of sec.rows){
    rows.push(new TableRow({cantSplit:true,children:[cell(W[0],[...(r.key?[en(r.key,{size:15,color:"7A6650"})]:[]),...r.en.split('\n').map((l,i)=>en(l,{bold:i==0,color:i==0?'231A11':undefined}))],"FAFAFA"),cell(W[1],r.ar.split('\n').map((l,i)=>ar(l,{bold:i==0})),"F5F9FE")]}));}
  body.push(new Table({width:{size:10200,type:WidthType.DXA},columnWidths:W,rows}));
}
const doc=new Document({sections:[{properties:{page:{margin:{top:900,bottom:900,left:850,right:850}}},children:body}]});
Packer.toBuffer(doc).then(b=>{fs.writeFileSync(process.argv[3],b);console.log('ok')});
