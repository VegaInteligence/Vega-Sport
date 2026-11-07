CASE WHEN (CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END) IN (0,11) THEN 'G'
    WHEN (CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)=1 OR ((CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)>=30 AND (CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)<40) OR (CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END) IN (51,59) THEN 'D'
    WHEN (CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)=2 OR ((CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)>=50 AND (CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)<80) THEN 'M'
    WHEN ((CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)>=80 AND (CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)<120) OR (CASE WHEN v.position_id IS NULL OR v.position_id_type='NoneType' THEN NULL
    WHEN v.position_id_type='bool' THEN CASE WHEN v.position_id='True' THEN 1 ELSE 0 END
    WHEN btrim(v.position_id)='' THEN 0
    WHEN btrim(v.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(v.position_id),'double precision') THEN btrim(v.position_id)::double precision END)=3 THEN 'O'
    WHEN (v.saves IS NOT NULL AND v.saves NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND v.saves>0 THEN 'G' ELSE 'F' END
